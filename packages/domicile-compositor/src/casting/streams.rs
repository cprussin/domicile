//! The Wayland thread's side of casting: routes requests and fills lent
//! buffers with each source's frames.
//!
//! - A cast window's commit is kept as a [`Snapshot`] before the client's
//!   buffer is released, so no client buffer is held for a stream.
//! - A monitor or region is drawn from the engine's display captures (see
//!   [`captures`](crate::casting::captures)). A region across monitors is one
//!   piece per monitor (see [`region`](crate::casting::region)).
//! - A damaged frame fills a lent buffer from what is kept.
//! - Damage that found no buffer is owed. It is filled when a buffer is lent,
//!   so a source that stops drawing still reaches the consumer. A stream's
//!   first frame is owed this way.
//! - Pointer motion damages the pointer's old and new places, for streams
//!   that show the pointer.

use std::collections::HashMap;
use std::os::fd::OwnedFd;
use std::path::PathBuf;
use std::time::Instant;

use pipewire as pw;
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::reexports::calloop::channel::Sender;
use smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer;
use tracing::{debug, warn};

use crate::casting::captured;
use crate::casting::captures::{Capturer, Captures, Frame};
use crate::casting::cursor::{arrow, embed, plan, CursorMode, Plan, Sprite};
use crate::casting::gpu::{self, FillError, Layer, Snapshot};
use crate::casting::lifecycle::Ended;
use crate::casting::negotiation::{offer, shm_layout, Pixel, MAX_FRAMERATE, PIXELS};
use crate::casting::pacing::{within, Due, Pacing, Rect};
use crate::casting::producer::{self, BufferId, StreamFormat, Target, ToPipewire, ToWayland};
use crate::casting::region::{self, damage_in_stream, in_frame, Layout, Screen};
use crate::casting::shm_copy::{copy, Client};
use crate::casting::{Event, Listener, Request, Source, StreamId};
use crate::engine::{CaptureId, CapturedFrame};

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

/// Every stream, on the Wayland thread.
pub struct Streams {
    news: Sender<ToWayland>,
    gpu: Option<Gpu>,
    /// Started on the first cast, so a desktop that never casts runs no
    /// PipeWire thread.
    to_pipewire: Option<pw::channel::Sender<ToPipewire>>,
    casts: HashMap<StreamId, Cast>,
    /// Each window's last frame size, offered when a stream starts.
    sizes: HashMap<String, (u32, u32)>,
    /// Each cast window's last frame.
    shots: HashMap<String, Shot>,
    /// The window under the pointer, and where, in its box's logical pixels.
    pointer: Option<(String, (f64, f64))>,
    /// Where the pointer is on the desktop, in logical pixels, when the
    /// compositor knows: over a window.
    desk_pointer: Option<(f64, f64)>,
    /// The monitors, for monitor and region streams.
    screens: Vec<Screen>,
    captures: Captures,
    sprite: Sprite,
}

/// A window's last frame and how to read it.
struct Shot {
    snapshot: Snapshot,
    crop: Rect,
    scale: i32,
}

/// What one stream shows.
enum Shows {
    Window(String),
    /// A rectangle of the desktop: a monitor, followed by name, or a region.
    Desk {
        monitor: Option<String>,
        target: Rect,
        layout: Layout,
    },
}

/// One stream.
struct Cast {
    shows: Shows,
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

/// What a stream's next frame is made of.
struct View<'a> {
    size: (u32, u32),
    layers: Vec<Layer<'a>>,
    /// The pointer, in stream pixels, or `None` off the source.
    pointer: Option<(f64, f64)>,
}

/// What one stream does with a frame.
enum Outcome {
    Nothing,
    Send(ToPipewire),
    Starved,
    Resize((u32, u32)),
    Failed(FillError),
}

impl Streams {
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
            desk_pointer: None,
            screens: Vec::new(),
            captures: Captures::default(),
            sprite: arrow(),
        }
    }

    /// Handles a caller's request. `window_open` says whether a window is
    /// open; `capturer` is the engine, if one is connected.
    pub fn request(
        &mut self,
        request: Request,
        window_open: impl Fn(&str) -> bool,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        match request {
            Request::Start {
                stream,
                source,
                cursor,
                listener,
            } => self.start(stream, source, cursor, listener, window_open, capturer),
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
        window_open: impl Fn(&str) -> bool,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        let shows = match source {
            Source::Window(app_id) if window_open(&app_id) => Shows::Window(app_id),
            Source::Window(_) => {
                debug!(?stream, "a cast of a window that is not open");
                listener(Event::Ended(Ended::SourceGone));
                return;
            }
            Source::Monitor(name) => {
                let Some(target) = self.monitor(&name) else {
                    debug!(?stream, %name, "a cast of a monitor that is not plugged in");
                    listener(Event::Ended(Ended::SourceGone));
                    return;
                };
                match self.desk(stream, Some(name), target, capturer) {
                    Ok(shows) => shows,
                    Err(why) => {
                        listener(Event::Ended(Ended::Failed(why)));
                        return;
                    }
                }
            }
            Source::Region(region) => {
                let target = (
                    region.position.0,
                    region.position.1,
                    region.size.0,
                    region.size.1,
                );
                match self.desk(stream, None, target, capturer) {
                    Ok(shows) => shows,
                    Err(why) => {
                        listener(Event::Ended(Ended::Failed(why)));
                        return;
                    }
                }
            }
        };
        let size = match &shows {
            // A window that has not drawn is offered at one pixel, and asks
            // again with its first frame.
            Shows::Window(app_id) => self.sizes.get(app_id).copied().unwrap_or((1, 1)),
            Shows::Desk { layout, .. } => layout.size,
        };
        let offered = offer(|pixel| {
            self.gpu
                .as_ref()
                .and_then(|gpu| gpu.modifiers.get(&pixel).cloned())
                .unwrap_or_default()
        });
        self.casts.insert(
            stream,
            Cast {
                shows,
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

    /// The desktop rectangle of the monitor named `name`.
    fn monitor(&self, name: &str) -> Option<Rect> {
        self.screens
            .iter()
            .find(|screen| screen.name == name)
            .map(|screen| screen.desk)
    }

    /// What `stream` shows of `target`, with the captures it draws from
    /// running.
    fn desk(
        &mut self,
        stream: StreamId,
        monitor: Option<String>,
        target: Rect,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) -> Result<Shows, String> {
        let layout = region::layout(target, &self.screens).map_err(|why| why.to_string())?;
        let capturer = capturer.ok_or("no engine is connected to capture the desktop")?;
        self.captures.show(
            stream,
            &self.capture_sizes(&layout),
            MAX_FRAMERATE,
            capturer,
        )?;
        Ok(Shows::Desk {
            monitor,
            target,
            layout,
        })
    }

    /// Each display `layout` draws from, at its mode size.
    fn capture_sizes(&self, layout: &Layout) -> Vec<(i64, (u32, u32))> {
        layout
            .pieces
            .iter()
            .filter_map(|piece| {
                let screen = self
                    .screens
                    .iter()
                    .find(|screen| screen.display == piece.display)?;
                Some((piece.display, mode(screen)))
            })
            .collect()
    }

    /// The monitors changed. Monitor and region streams follow: a gone
    /// monitor ends its streams, and a new size is negotiated again.
    pub fn screens(
        &mut self,
        screens: Vec<Screen>,
        mut capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        self.screens = screens;
        let desk: Vec<StreamId> = self
            .casts
            .iter()
            .filter(|(_, cast)| matches!(cast.shows, Shows::Desk { .. }))
            .map(|(&stream, _)| stream)
            .collect();
        for stream in desk {
            let Some(Shows::Desk {
                monitor, target, ..
            }) = self.casts.get(&stream).map(|cast| &cast.shows)
            else {
                continue;
            };
            let (monitor, target) = (monitor.clone(), *target);
            let target = match &monitor {
                Some(name) => match self.monitor(name) {
                    Some(target) => target,
                    None => {
                        self.end(stream, Ended::SourceGone, capturer.as_deref_mut());
                        continue;
                    }
                },
                None => target,
            };
            match self.desk(stream, monitor, target, capturer.as_deref_mut()) {
                Ok(shows) => {
                    let cast = self.casts.get_mut(&stream).expect("listed above");
                    cast.shows = shows;
                    if let Some(pacing) = cast.pacing.as_mut() {
                        let (width, height) = cast.asked;
                        pacing.damaged(&[(0, 0, width as i32, height as i32)]);
                    }
                }
                Err(why) => self.end(stream, Ended::Failed(why), capturer.as_deref_mut()),
            }
        }
    }

    /// Ends `stream` from this side.
    fn end(
        &mut self,
        stream: StreamId,
        why: Ended,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        if let Some(capturer) = capturer {
            self.captures.forget(stream, capturer);
        }
        self.send(ToPipewire::End { stream, why });
    }

    /// Handles news from the PipeWire thread. Returns when to call
    /// [`Streams::tick`], if a filled frame waits.
    pub fn news(
        &mut self,
        news: ToWayland,
        renderer: Option<&mut GlesRenderer>,
        capturer: Option<&mut (dyn Capturer + 'static)>,
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
                match self.casts.remove(&stream).map(|cast| cast.shows) {
                    Some(Shows::Window(app_id)) => {
                        let shown = self.casts.values().any(
                            |other| matches!(&other.shows, Shows::Window(id) if *id == app_id),
                        );
                        if !shown {
                            self.shots.remove(&app_id);
                        }
                    }
                    Some(Shows::Desk { .. }) => {
                        if let Some(capturer) = capturer {
                            self.captures.forget(stream, capturer);
                        }
                    }
                    None => {}
                }
            }
        }
        self.next_due()
    }

    /// A window committed a frame. Fills its streams' buffers and sends the
    /// ones that are due. Returns when to call [`Streams::tick`], if a filled
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
            .filter(|(_, cast)| matches!(&cast.shows, Shows::Window(id) if id == frame.app_id))
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

    /// The engine captured a frame of a display. Keeps it and fills the
    /// buffers of the streams that show that display. Returns when to call
    /// [`Streams::tick`], if a filled frame waits.
    pub fn captured(
        &mut self,
        capture: CaptureId,
        id: u64,
        captured: Result<CapturedFrame, String>,
        mut renderer: Option<&mut GlesRenderer>,
        capturer: &mut (dyn Capturer + 'static),
        now: Instant,
    ) -> Option<Instant> {
        let Some(display) = self.captures.display_of(capture) else {
            capturer.release(capture, id);
            return self.next_due();
        };
        let kept = captured.map_err(|why| why.to_string()).and_then(|frame| {
            let (snapshot, kept) = captured::snapshot(&frame, renderer.as_deref_mut())
                .map_err(|why| why.to_string())?;
            Ok((frame, snapshot, kept))
        });
        let (frame, snapshot, kept) = match kept {
            Ok(kept) => kept,
            Err(why) => {
                capturer.release(capture, id);
                let engine_display = display;
                warn!(%why, engine_display, "a captured frame could not be kept");
                for stream in self.captures.streams_of(display) {
                    self.end(stream, Ended::Failed(why.clone()), Some(&mut *capturer));
                }
                return self.next_due();
            }
        };
        let content = frame.content;
        let damage = frame.damage.unwrap_or(content);
        self.captures
            .keep(capture, id, Frame { snapshot, content }, kept, capturer);
        let logical = self
            .screens
            .iter()
            .find(|screen| screen.display == display)
            .map(|screen| (screen.desk.2, screen.desk.3));
        let Some(logical) = logical else {
            return self.next_due();
        };
        for stream in self.captures.streams_of(display) {
            let Some(Shows::Desk { layout, .. }) = self.casts.get(&stream).map(|cast| &cast.shows)
            else {
                continue;
            };
            let damage: Vec<Rect> = layout
                .pieces
                .iter()
                .filter(|piece| piece.display == display)
                .filter_map(|piece| damage_in_stream(piece, logical, content, damage))
                .collect();
            if !damage.is_empty() {
                self.offer(stream, damage, renderer.as_deref_mut(), now);
            }
        }
        self.next_due()
    }

    /// The engine stopped a capture. Its streams end.
    pub fn capture_ended(
        &mut self,
        capture: CaptureId,
        mut capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        for stream in self.captures.ended(capture) {
            self.end(
                stream,
                Ended::Failed("the engine stopped capturing the monitor".into()),
                capturer.as_deref_mut(),
            );
        }
    }

    /// The engine was replaced, and its captures with it. Monitor and region
    /// streams end.
    pub fn engine_replaced(&mut self) {
        self.captures = Captures::default();
        let desk: Vec<StreamId> = self
            .casts
            .iter()
            .filter(|(_, cast)| matches!(cast.shows, Shows::Desk { .. }))
            .map(|(&stream, _)| stream)
            .collect();
        for stream in desk {
            self.send(ToPipewire::End {
                stream,
                why: Ended::Failed("the engine was replaced".into()),
            });
        }
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
    /// `desk` is the same point on the desktop. Streams that show it are
    /// damaged where it was and where it is.
    pub fn pointer(
        &mut self,
        at: Option<(String, (f64, f64))>,
        desk: Option<(f64, f64)>,
        mut renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
        let before = std::mem::replace(&mut self.pointer, at);
        let desk_before = std::mem::replace(&mut self.desk_pointer, desk);
        let touched: Vec<(StreamId, Vec<Rect>)> = self
            .casts
            .iter()
            .filter(|(_, cast)| cast.cursor != CursorMode::Hidden)
            .filter_map(|(&stream, cast)| {
                let places = match &cast.shows {
                    Shows::Window(app_id) => {
                        let shot = self.shots.get(app_id)?;
                        [before.as_ref(), self.pointer.as_ref()]
                            .into_iter()
                            .flatten()
                            .filter(|(id, _)| id == app_id)
                            .map(|(_, point)| in_window(*point, shot.scale))
                            .collect::<Vec<_>>()
                    }
                    Shows::Desk { target, layout, .. } => [desk_before, self.desk_pointer]
                        .into_iter()
                        .flatten()
                        .filter_map(|point| on_desk(point, *target, layout))
                        .collect(),
                };
                let size = view_size(&cast.shows, &self.shots)?;
                let damage: Vec<Rect> = places
                    .into_iter()
                    .filter_map(|(x, y)| {
                        let (width, height) = self.sprite.size;
                        within(
                            (
                                x.round() as i32 - self.sprite.hotspot.0,
                                y.round() as i32 - self.sprite.hotspot.1,
                                width as i32,
                                height as i32,
                            ),
                            (0, 0, size.0 as i32, size.1 as i32),
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
            .filter(|(_, cast)| matches!(&cast.shows, Shows::Window(id) if id == app_id))
            .map(|(&stream, _)| stream)
            .collect();
        for stream in gone {
            self.send(ToPipewire::End {
                stream,
                why: Ended::SourceGone,
            });
        }
    }

    /// Damages `stream` by `damage` and fills a buffer from what it shows, if
    /// one is lent.
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
        let Some(view) = view(
            &cast.shows,
            &self.shots,
            &self.captures,
            &self.screens,
            self.pointer.as_ref(),
            self.desk_pointer,
        ) else {
            return;
        };
        match step(stream, cast, &view, damage, &self.sprite, renderer, now) {
            Outcome::Nothing => {}
            Outcome::Send(filled) => self.send(filled),
            Outcome::Starved => self.send(ToPipewire::Starved { stream }),
            Outcome::Resize(size) => {
                debug!(?stream, ?size, "a cast source changed size");
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

/// A screen's mode: its logical size at its density.
fn mode(screen: &Screen) -> (u32, u32) {
    (
        (f64::from(screen.desk.2) * screen.scale).round() as u32,
        (f64::from(screen.desk.3) * screen.scale).round() as u32,
    )
}

/// A point in a window's box, in frame pixels.
fn in_window(point: (f64, f64), scale: i32) -> (f64, f64) {
    (point.0 * f64::from(scale), point.1 * f64::from(scale))
}

/// A desktop point in a stream of `target`, in stream pixels, or `None` off
/// it.
fn on_desk(point: (f64, f64), target: Rect, layout: &Layout) -> Option<(f64, f64)> {
    let (x, y) = (point.0 - f64::from(target.0), point.1 - f64::from(target.1));
    let inside = x >= 0.0 && y >= 0.0 && x < f64::from(target.2) && y < f64::from(target.3);
    let scale = f64::from(layout.size.0) / f64::from(target.2);
    inside.then_some((x * scale, y * scale))
}

/// The size a stream's frames are, once its source has drawn.
fn view_size(shows: &Shows, shots: &HashMap<String, Shot>) -> Option<(u32, u32)> {
    match shows {
        Shows::Window(app_id) => shots
            .get(app_id)
            .map(|shot| (shot.crop.2 as u32, shot.crop.3 as u32)),
        Shows::Desk { layout, .. } => Some(layout.size),
    }
}

/// What a stream's next frame is made of, or `None` until every source it
/// draws from has drawn.
fn view<'a>(
    shows: &Shows,
    shots: &'a HashMap<String, Shot>,
    captures: &'a Captures,
    screens: &[Screen],
    pointer: Option<&(String, (f64, f64))>,
    desk_pointer: Option<(f64, f64)>,
) -> Option<View<'a>> {
    match shows {
        Shows::Window(app_id) => {
            let shot = shots.get(app_id)?;
            Some(View {
                size: (shot.crop.2 as u32, shot.crop.3 as u32),
                layers: vec![Layer {
                    snapshot: &shot.snapshot,
                    from: shot.crop,
                    to: (0, 0, shot.crop.2, shot.crop.3),
                }],
                pointer: pointer
                    .filter(|(id, _)| id == app_id)
                    .map(|(_, point)| in_window(*point, shot.scale)),
            })
        }
        Shows::Desk { target, layout, .. } => {
            let layers = layout
                .pieces
                .iter()
                .map(|piece| {
                    let frame = captures.frame(piece.display)?;
                    let screen = screens
                        .iter()
                        .find(|screen| screen.display == piece.display)?;
                    Some(Layer {
                        snapshot: &frame.snapshot,
                        from: in_frame(piece.from, (screen.desk.2, screen.desk.3), frame.content),
                        to: piece.to,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(View {
                size: layout.size,
                layers,
                pointer: desk_pointer.and_then(|point| on_desk(point, *target, layout)),
            })
        }
    }
}

/// Damages `cast` and fills a buffer from `view` if one is lent.
fn step(
    stream: StreamId,
    cast: &mut Cast,
    view: &View,
    damage: Vec<Rect>,
    sprite: &Sprite,
    renderer: Option<&mut GlesRenderer>,
    now: Instant,
) -> Outcome {
    let (Some(format), Some(pacing), true) = (cast.format, cast.pacing.as_mut(), cast.filling)
    else {
        return Outcome::Nothing;
    };
    if format.size != view.size {
        if cast.asked == view.size {
            return Outcome::Nothing;
        }
        cast.asked = view.size;
        return Outcome::Resize(view.size);
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
    let cursor = plan(cast.cursor, view.pointer);
    let fence = match fill(target, format, &view.layers, cursor, sprite, renderer) {
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

/// Writes `layers` into `target`. A dmabuf target returns the fence the
/// PipeWire thread waits on before queueing.
fn fill(
    target: &Target,
    format: StreamFormat,
    layers: &[Layer],
    cursor: Plan,
    sprite: &Sprite,
    mut renderer: Option<&mut GlesRenderer>,
) -> Result<Option<OwnedFd>, FillError> {
    match target {
        Target::Shm(mapping) => {
            let (stride, _) = shm_layout(format.size);
            let stride = stride as usize;
            // SAFETY: the buffer is lent to this thread until it is sent.
            let bytes = unsafe { mapping.bytes() };
            for layer in layers {
                match layer.snapshot {
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
                        layer.from,
                        bytes,
                        stride,
                        format.pixel,
                        layer.to,
                    ),
                    Snapshot::Texture(texture) => {
                        // Read back at the source's size, then scale on copy.
                        let row = layer.from.2 as usize * 4;
                        let mut read = vec![0; row * layer.from.3 as usize];
                        gpu::read_back(
                            renderer.as_deref_mut().ok_or(FillError::NoGpu)?,
                            texture,
                            layer.from,
                            &mut read,
                            row,
                        )?;
                        copy(
                            &Client {
                                bytes: &read,
                                stride: row,
                                alpha: true,
                            },
                            (0, 0, layer.from.2, layer.from.3),
                            bytes,
                            stride,
                            format.pixel,
                            layer.to,
                        );
                    }
                }
            }
            if let Plan::Embed { at } = cursor {
                embed(bytes, stride, format.size, sprite, at);
            }
            Ok(None)
        }
        Target::Dmabuf(dmabuf) => gpu::draw(
            renderer.ok_or(FillError::NoGpu)?,
            layers,
            dmabuf,
            cursor,
            sprite,
        ),
    }
}
