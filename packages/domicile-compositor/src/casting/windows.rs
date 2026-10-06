//! The Wayland thread's side of casting: routes requests and fills lent
//! buffers with windows' frames.
//!
//! - A cast window's commit is kept as a [`Snapshot`] before the client's
//!   buffer is released, so no client buffer is held for a stream.
//! - A damaged commit fills a lent buffer from the snapshot.
//! - Damage that found no buffer is owed. It is filled from the snapshot when
//!   a buffer is lent, so a window that stops drawing still reaches the
//!   consumer. A stream's first frame is owed this way.
//! - Pointer motion over a window damages the pointer's old and new places,
//!   for streams that show the pointer.

use std::collections::HashMap;
use std::os::fd::OwnedFd;
use std::path::PathBuf;
use std::time::Instant;

use pipewire as pw;
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::reexports::calloop::channel::Sender;
use smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer;
use tracing::{debug, warn};

use crate::casting::cursor::{arrow, embed, plan, CursorMode, Plan, Sprite};
use crate::casting::gpu::{self, FillError, Snapshot};
use crate::casting::lifecycle::Ended;
use crate::casting::negotiation::{offer, shm_layout, Pixel, PIXELS};
use crate::casting::pacing::{within, Due, Pacing, Rect};
use crate::casting::producer::{self, BufferId, StreamFormat, Target, ToPipewire, ToWayland};
use crate::casting::shm_copy::{copy, Client};
use crate::casting::{Event, Listener, Request, Source, StreamId};

/// A window's frame, as its commit brought it.
pub struct Committed<'a> {
    pub app_id: &'a str,
    pub buffer: &'a WlBuffer,
    /// The part of the buffer that is the window, in buffer pixels.
    pub crop: Rect,
    /// The buffer's scale, for the pointer's position.
    pub scale: i32,
    /// The bounding box of the commit's damage, in buffer pixels.
    pub damage: Option<Rect>,
}

/// The GPU the streams' dmabufs are allocated on.
pub struct Gpu {
    /// The render node, for the PipeWire thread's allocator.
    node: PathBuf,
    /// The modifiers the renderer can draw each layout in.
    modifiers: HashMap<Pixel, Vec<u64>>,
}

impl Gpu {
    /// The GPU on `node`, where `modifiers` gives the modifiers the renderer
    /// draws a DRM fourcc in.
    pub fn new(node: PathBuf, modifiers: impl Fn(u32) -> Vec<u64>) -> Self {
        Self {
            node,
            modifiers: PIXELS
                .iter()
                .map(|&pixel| (pixel, modifiers(producer::fourcc(pixel))))
                .collect(),
        }
    }
}

/// Every window stream, on the Wayland thread.
pub struct Windows {
    news: Sender<ToWayland>,
    gpu: Option<Gpu>,
    /// Started on the first cast, so a desktop that never casts runs no
    /// PipeWire thread.
    to_pipewire: Option<pw::channel::Sender<ToPipewire>>,
    casts: HashMap<StreamId, WindowCast>,
    /// Each window's last frame size, offered when a stream starts.
    sizes: HashMap<String, (u32, u32)>,
    /// Each cast window's last frame.
    shots: HashMap<String, Shot>,
    /// The window under the pointer, and where, in its box's logical pixels.
    pointer: Option<(String, (f64, f64))>,
    sprite: Sprite,
}

/// A window's last frame and how to read it.
struct Shot {
    snapshot: Snapshot,
    crop: Rect,
    scale: i32,
}

/// One stream of a window.
struct WindowCast {
    app_id: String,
    cursor: CursorMode,
    format: Option<StreamFormat>,
    pacing: Option<Pacing<BufferId>>,
    targets: HashMap<BufferId, Target>,
    filling: bool,
    /// The size last asked of PipeWire, so a resize is asked once.
    asked: (u32, u32),
    /// The pointer as the filled, unsent frame shows it.
    cursor_plan: Plan,
}

/// What one stream does with a frame.
enum Outcome {
    Nothing,
    Send(ToPipewire),
    Starved,
    Resize((u32, u32)),
    Failed(FillError),
}

impl Windows {
    /// Streams whose news arrives through `news`. `gpu` is `None` without a
    /// renderer and allocator, and streams then offer shm only.
    pub fn new(news: Sender<ToWayland>, gpu: Option<Gpu>) -> Self {
        Self {
            news,
            gpu,
            to_pipewire: None,
            casts: HashMap::new(),
            sizes: HashMap::new(),
            shots: HashMap::new(),
            pointer: None,
            sprite: arrow(),
        }
    }

    /// Handles a caller's request. `exists` says whether the source is open.
    pub fn request(&mut self, request: Request, exists: impl Fn(&Source) -> bool) {
        match request {
            Request::Start {
                stream,
                source,
                cursor,
                listener,
            } => self.start(stream, source, cursor, listener, exists),
            Request::Stop { stream } => {
                if self.casts.contains_key(&stream) {
                    self.send(ToPipewire::End {
                        stream,
                        why: Ended::Stopped,
                    });
                }
            }
        }
    }

    fn start(
        &mut self,
        stream: StreamId,
        source: Source,
        cursor: CursorMode,
        mut listener: Listener,
        exists: impl Fn(&Source) -> bool,
    ) {
        if !exists(&source) {
            debug!(?stream, ?source, "a cast of a source that is not open");
            listener(Event::Ended(Ended::SourceGone));
            return;
        }
        let Source::Window(app_id) = source;
        // A window that has not drawn is offered at one pixel, and asks again
        // with its first frame.
        let size = self.sizes.get(&app_id).copied().unwrap_or((1, 1));
        let offered = offer(|pixel| {
            self.gpu
                .as_ref()
                .and_then(|gpu| gpu.modifiers.get(&pixel).cloned())
                .unwrap_or_default()
        });
        self.casts.insert(
            stream,
            WindowCast {
                app_id,
                cursor,
                format: None,
                pacing: None,
                targets: HashMap::new(),
                filling: false,
                asked: size,
                cursor_plan: Plan::Nothing,
            },
        );
        self.send(ToPipewire::Start {
            stream,
            offered,
            size,
            cursor,
            listener,
        });
    }

    /// Handles news from the PipeWire thread. Returns when to call
    /// [`Windows::tick`], if a filled frame waits.
    pub fn news(
        &mut self,
        news: ToWayland,
        renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
        match news {
            ToWayland::Format {
                stream,
                format,
                framerate,
            } => {
                if let Some(cast) = self.casts.get_mut(&stream) {
                    let mut pacing = Pacing::new(framerate);
                    // The consumer has no frame yet: the first is owed.
                    pacing.damaged(&[(0, 0, format.size.0 as i32, format.size.1 as i32)]);
                    cast.format = Some(format);
                    cast.pacing = Some(pacing);
                    cast.targets.clear();
                }
            }
            ToWayland::Added {
                stream,
                buffer,
                target,
            } => {
                if let Some(cast) = self.casts.get_mut(&stream) {
                    cast.targets.insert(buffer, target);
                }
            }
            ToWayland::Removed { stream, buffer } => {
                if let Some(cast) = self.casts.get_mut(&stream) {
                    cast.targets.remove(&buffer);
                    // PipeWire removes buffers all at once, to make new ones.
                    if let Some(pacing) = cast.pacing.as_mut() {
                        pacing.forget_buffers();
                    }
                }
            }
            ToWayland::Lent { stream, buffer } => {
                if let Some(pacing) = self.casts.get_mut(&stream).and_then(|c| c.pacing.as_mut()) {
                    pacing.lent(buffer);
                }
                // Fill what is owed, if anything.
                self.offer(stream, Vec::new(), renderer, now);
            }
            ToWayland::Filling { stream, on } => {
                if let Some(cast) = self.casts.get_mut(&stream) {
                    cast.filling = on;
                }
            }
            ToWayland::Ended { stream } => {
                if let Some(cast) = self.casts.remove(&stream) {
                    if !self.casts.values().any(|other| other.app_id == cast.app_id) {
                        self.shots.remove(&cast.app_id);
                    }
                }
            }
        }
        self.next_due()
    }

    /// A window committed a frame. Fills its streams' buffers and sends the
    /// ones that are due. Returns when to call [`Windows::tick`], if a filled
    /// frame waits.
    pub fn committed(
        &mut self,
        frame: Committed,
        mut renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
        let size = (frame.crop.2 as u32, frame.crop.3 as u32);
        self.sizes.insert(frame.app_id.to_string(), size);
        let streams: Vec<_> = self
            .casts
            .iter()
            .filter(|(_, cast)| cast.app_id == frame.app_id)
            .map(|(&stream, _)| stream)
            .collect();
        if streams.is_empty() {
            return self.next_due();
        }
        match gpu::snapshot(frame.buffer, renderer.as_deref_mut()) {
            Ok(snapshot) => {
                self.shots.insert(
                    frame.app_id.to_string(),
                    Shot {
                        snapshot,
                        crop: frame.crop,
                        scale: frame.scale,
                    },
                );
            }
            Err(why) => {
                for stream in streams {
                    self.fail(stream, &why);
                }
                return self.next_due();
            }
        }
        let damage = frame
            .damage
            .and_then(|damage| within(damage, frame.crop))
            .map_or_else(Vec::new, |damage| vec![damage]);
        for stream in streams {
            self.offer(stream, damage.clone(), renderer.as_deref_mut(), now);
        }
        self.next_due()
    }

    /// Sends the filled frames that are due. Returns when to call again.
    pub fn tick(&mut self, now: Instant) -> Option<Instant> {
        let mut sent = Vec::new();
        for (&stream, cast) in &mut self.casts {
            if let Some(Due::Send { buffer, damage }) = cast.pacing.as_mut().map(|p| p.due(now)) {
                sent.push(ToPipewire::Filled {
                    stream,
                    buffer,
                    damage,
                    cursor: cast.cursor_plan,
                    // Waited on when it was filled; see `gpu::draw`.
                    fence: None,
                });
            }
        }
        for filled in sent {
            self.send(filled);
        }
        self.next_due()
    }

    /// The pointer moved to `at`, in `app_id`'s box, or left every window.
    /// Streams that show it are damaged where it was and where it is.
    pub fn pointer(
        &mut self,
        at: Option<(String, (f64, f64))>,
        mut renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
        let before = std::mem::replace(&mut self.pointer, at);
        let moved = [before.as_ref(), self.pointer.as_ref()];
        let touched: Vec<(StreamId, Vec<Rect>)> = self
            .casts
            .iter()
            .filter(|(_, cast)| cast.cursor != CursorMode::Hidden)
            .filter_map(|(&stream, cast)| {
                let shot = self.shots.get(&cast.app_id)?;
                let damage: Vec<Rect> = moved
                    .iter()
                    .flatten()
                    .filter(|(app_id, _)| *app_id == cast.app_id)
                    .filter_map(|(_, point)| {
                        let (x, y) = in_frame(*point, shot.scale);
                        let (width, height) = self.sprite.size;
                        within(
                            (
                                x.round() as i32 - self.sprite.hotspot.0,
                                y.round() as i32 - self.sprite.hotspot.1,
                                width as i32,
                                height as i32,
                            ),
                            (0, 0, shot.crop.2, shot.crop.3),
                        )
                    })
                    .collect();
                (!damage.is_empty()).then_some((stream, damage))
            })
            .collect();
        for (stream, damage) in touched {
            self.offer(stream, damage, renderer.as_deref_mut(), now);
        }
        self.next_due()
    }

    /// A window closed: its streams end.
    pub fn window_gone(&mut self, app_id: &str) {
        self.sizes.remove(app_id);
        self.shots.remove(app_id);
        let gone: Vec<_> = self
            .casts
            .iter()
            .filter(|(_, cast)| cast.app_id == app_id)
            .map(|(&stream, _)| stream)
            .collect();
        for stream in gone {
            self.send(ToPipewire::End {
                stream,
                why: Ended::SourceGone,
            });
        }
    }

    /// Damages `stream` by `damage` and fills a buffer from the window's
    /// snapshot, if one is lent.
    fn offer(
        &mut self,
        stream: StreamId,
        damage: Vec<Rect>,
        renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) {
        let Some(cast) = self.casts.get_mut(&stream) else {
            return;
        };
        let Some(shot) = self.shots.get(&cast.app_id) else {
            return;
        };
        let pointer = self
            .pointer
            .as_ref()
            .filter(|(app_id, _)| *app_id == cast.app_id)
            .map(|(_, point)| in_frame(*point, shot.scale));
        match step(
            stream,
            cast,
            shot,
            damage,
            pointer,
            &self.sprite,
            renderer,
            now,
        ) {
            Outcome::Nothing => {}
            Outcome::Send(filled) => self.send(filled),
            Outcome::Starved => self.send(ToPipewire::Starved { stream }),
            Outcome::Resize(size) => {
                debug!(?stream, ?size, "a cast window changed size");
                self.send(ToPipewire::Resize { stream, size });
            }
            Outcome::Failed(why) => self.fail(stream, &why),
        }
    }

    fn fail(&mut self, stream: StreamId, why: &FillError) {
        warn!(?stream, %why, "a cast frame could not be filled");
        self.send(ToPipewire::End {
            stream,
            why: Ended::Failed(why.to_string()),
        });
    }

    /// The earliest instant a filled frame is due.
    fn next_due(&self) -> Option<Instant> {
        self.casts
            .values()
            .filter_map(|cast| cast.pacing.as_ref()?.waiting_until())
            .min()
    }

    fn send(&mut self, request: ToPipewire) {
        let node = self.gpu.as_ref().map(|gpu| gpu.node.clone());
        let news = self.news.clone();
        self.to_pipewire
            .get_or_insert_with(|| producer::spawn(news, node))
            .send(request)
            .unwrap_or_else(|_| panic!("the PipeWire thread outlives the compositor's casts"));
    }
}

/// A point in a window's box, in frame pixels.
fn in_frame(point: (f64, f64), scale: i32) -> (f64, f64) {
    (point.0 * f64::from(scale), point.1 * f64::from(scale))
}

/// Damages `cast` and fills a buffer from `shot` if one is lent.
#[allow(clippy::too_many_arguments)] // Disjoint borrows of `Windows`.
fn step(
    stream: StreamId,
    cast: &mut WindowCast,
    shot: &Shot,
    damage: Vec<Rect>,
    pointer: Option<(f64, f64)>,
    sprite: &Sprite,
    renderer: Option<&mut GlesRenderer>,
    now: Instant,
) -> Outcome {
    let (Some(format), Some(pacing), true) = (cast.format, cast.pacing.as_mut(), cast.filling)
    else {
        return Outcome::Nothing;
    };
    let size = (shot.crop.2 as u32, shot.crop.3 as u32);
    if format.size != size {
        if cast.asked == size {
            return Outcome::Nothing;
        }
        cast.asked = size;
        return Outcome::Resize(size);
    }
    if damage.is_empty() && !pacing.owed() {
        return Outcome::Nothing;
    }
    let Some(buffer) = pacing.damaged(&damage) else {
        return Outcome::Starved;
    };
    let target = cast
        .targets
        .get(&buffer)
        .expect("PipeWire adds a buffer before lending it");
    let cursor = plan(cast.cursor, pointer);
    let fence = match fill(target, format, shot, cursor, sprite, renderer) {
        Ok(fence) => fence,
        Err(why) => return Outcome::Failed(why),
    };
    cast.cursor_plan = cursor;
    match pacing.due(now) {
        Due::Send { buffer, damage } => Outcome::Send(ToPipewire::Filled {
            stream,
            buffer,
            damage,
            cursor,
            fence,
        }),
        Due::At(_) | Due::Nothing => Outcome::Nothing,
    }
}

/// Writes `shot` into `target`. A dmabuf target returns the fence the
/// PipeWire thread waits on before queueing.
fn fill(
    target: &Target,
    format: StreamFormat,
    shot: &Shot,
    cursor: Plan,
    sprite: &Sprite,
    renderer: Option<&mut GlesRenderer>,
) -> Result<Option<OwnedFd>, FillError> {
    match target {
        Target::Shm(mapping) => {
            let (stride, _) = shm_layout(format.size);
            let stride = stride as usize;
            // SAFETY: the buffer is lent to this thread until it is sent.
            let bytes = unsafe { mapping.bytes() };
            match &shot.snapshot {
                Snapshot::Pixels {
                    bytes: pixels,
                    stride: from,
                    alpha,
                    ..
                } => copy(
                    &Client {
                        bytes: pixels,
                        stride: *from,
                        alpha: *alpha,
                    },
                    shot.crop,
                    bytes,
                    stride,
                    format.pixel,
                ),
                Snapshot::Texture(texture) => gpu::read_back(
                    renderer.ok_or(FillError::NoGpu)?,
                    texture,
                    shot.crop,
                    bytes,
                    stride,
                )?,
            }
            if let Plan::Embed { at } = cursor {
                embed(bytes, stride, format.size, sprite, at);
            }
            Ok(None)
        }
        Target::Dmabuf(dmabuf) => gpu::draw(
            renderer.ok_or(FillError::NoGpu)?,
            &shot.snapshot,
            shot.crop,
            dmabuf,
            cursor,
            sprite,
        ),
    }
}
