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
//! - A shot of the desk (see [`shots`](crate::casting::shots)) shows every
//!   monitor like a stream, until each has a frame.
//! - A shot of a browser window alone is the first frame of an engine
//!   capture of its page, which then stops.

use std::collections::{HashMap, HashSet};
use std::os::fd::OwnedFd;
use std::path::PathBuf;
use std::time::Instant;

use domicile_protocol::{PointerOverWindow, ShotWindow};
use pipewire as pw;
use smithay::backend::allocator::Buffer as _;
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::reexports::calloop::channel::Sender;
use smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer;
use smithay::utils::Transform;
use tracing::{debug, warn};

use crate::buffer_transform::Sampled;
use crate::casting::captured::{self, Kept};
use crate::casting::captures::{Capturer, Captures, Frame};
use crate::casting::cursor::{arrow, at_density, embed, plan, CursorMode, Plan, Sprite};
use crate::casting::gpu::{self, FillError, Layer, Snapshot};
use crate::casting::lifecycle::Ended;
use crate::casting::negotiation::{offer, shm_layout, Pixel, MAX_FRAMERATE, PIXELS};
use crate::casting::pacing::{within, Due, Pacing, Rect};
use crate::casting::paint::paint;
use crate::casting::producer::{self, BufferId, StreamFormat, Target, ToPipewire, ToWayland};
use crate::casting::region::{self, damage_in_stream, in_frame, Layout, Screen};
use crate::casting::shots::{
    self, compose, desk_of, monitors, Desk, Developed, DevelopedWindow, Shown,
};
use crate::casting::{Candidate, Event, Listener, Region, Request, Source, StreamId};
use crate::engine::{CaptureId, CapturedFrame};

/// A window's frame, as its commit brought it.
pub struct Committed<'a> {
    pub app_id: &'a str,
    pub buffer: &'a WlBuffer,
    /// The part of the buffer that is the window, in buffer pixels, and the
    /// turn that makes it upright.
    pub sampled: Sampled,
    /// How many buffer pixels span one of the surface's points across and
    /// down, for the pointer's position.
    pub pixels_a_point: (f64, f64),
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
    /// Each window's last frame the engine shows, for a shot of it alone.
    shown: HashMap<String, Shown>,
    /// The window under the pointer, and where, in its box's logical pixels.
    pointer: Option<(String, (f64, f64))>,
    /// Where the engine reports the pointer.
    engine_pointer: EnginePointer,
    /// The monitors, for monitor and region streams.
    screens: Vec<Screen>,
    captures: Captures,
    /// Shots waiting for their monitors' frames.
    shooting: Vec<Shooting>,
    /// Shots of one browser window alone, by the capture whose first frame
    /// they wait for.
    browser_shots: HashMap<CaptureId, DevelopedWindow>,
    /// The pages browser window streams show, by their capture.
    pages: HashMap<CaptureId, Page>,
    sprite: Sprite,
}

/// A shot of the desk, waiting for a frame of every monitor.
struct Shooting {
    stream: StreamId,
    /// The desk, in logical pixels.
    desk: Rect,
    layout: Layout,
    windows: Vec<ShotWindow>,
    /// Each monitor's make and model, by name.
    descriptions: HashMap<String, String>,
    developed: Developed,
}

/// A window's last frame and how to read it.
struct Shot {
    snapshot: Snapshot,
    sampled: Sampled,
    pixels_a_point: (f64, f64),
}

/// What one stream shows.
enum Shows {
    Window(String),
    /// A browser window's page alone, from this engine capture, which the
    /// stream owns.
    BrowserWindow(CaptureId),
    /// A rectangle of the desktop: a monitor, followed by name, or a region.
    Desk {
        monitor: Option<String>,
        target: Rect,
        layout: Layout,
    },
}

/// Where the engine reports the pointer.
#[derive(Clone, Debug, Default, PartialEq)]
struct EnginePointer {
    /// On the desktop, in logical pixels, or `None` off it.
    desk: Option<(f64, f64)>,
    /// Over each browser window's page, by id, as a fraction of the page.
    pages: HashMap<String, (f64, f64)>,
}

/// A browser window's page, as its capture last drew it.
#[derive(Default)]
struct Page {
    /// The browser window's id.
    window: String,
    frame: Option<Frame>,
    /// The engine's frame `frame` samples, if it is sampled in place.
    held: Option<u64>,
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
            shown: HashMap::new(),
            pointer: None,
            engine_pointer: EnginePointer::default(),
            screens: Vec::new(),
            captures: Captures::default(),
            shooting: Vec::new(),
            browser_shots: HashMap::new(),
            pages: HashMap::new(),
            sprite: arrow(),
        }
    }

    /// Handles a caller's request. `open` lists the windows that can be cast
    /// now, which a shot also names; `capturer` is the engine, if one is
    /// connected.
    pub fn request(
        &mut self,
        request: Request,
        open: impl FnOnce() -> Vec<Candidate>,
        renderer: Option<&mut GlesRenderer>,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        match request {
            Request::Start {
                stream,
                source,
                cursor,
                listener,
            } => {
                let open = open();
                let window_open = |app_id: &str| {
                    open.iter().any(
                        |candidate| matches!(&candidate.source, Source::Window(id) if id == app_id),
                    )
                };
                self.start(stream, source, cursor, listener, window_open, capturer);
            }
            Request::List { reply } => reply.send(open()),
            Request::Shoot { stream, developed } => {
                let desk = desk_of(&self.screens).ok_or_else(|| "no monitor is plugged in".into());
                self.shoot(stream, desk, open(), developed, renderer, capturer);
            }
            Request::ShootMonitor {
                stream,
                name,
                region,
                developed,
            } => {
                let part = self.monitor_part(&name, region);
                self.shoot(stream, part, Vec::new(), developed, renderer, capturer);
            }
            Request::ShootBrowserWindow { id, developed } => {
                self.shoot_browser_window(&id, developed, capturer);
            }
            Request::ShootWindow { app_id, developed } => developed(
                self.shown
                    .get(&app_id)
                    .ok_or_else(|| format!("window {app_id} has shown no frame"))
                    .and_then(|shown| shots::window(shown, renderer)),
            ),
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
        let shows = match self.shows(stream, source, window_open, capturer) {
            Ok(shows) => shows,
            Err(why) => {
                listener(Event::Ended(why));
                return;
            }
        };
        let size = match &shows {
            // A window that has not drawn is offered at one pixel, and asks
            // again with its first frame. So is a browser window's page.
            Shows::Window(app_id) => self.sizes.get(app_id).copied().unwrap_or((1, 1)),
            Shows::BrowserWindow(_) => (1, 1),
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

    /// What `stream` shows of `source`, with any capture it draws from
    /// running, or why it cannot.
    fn shows(
        &mut self,
        stream: StreamId,
        source: Source,
        window_open: impl Fn(&str) -> bool,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) -> Result<Shows, Ended> {
        match source {
            Source::Window(app_id) if window_open(&app_id) => Ok(Shows::Window(app_id)),
            Source::Window(_) => {
                debug!(?stream, "a cast of a window that is not open");
                Err(Ended::SourceGone)
            }
            Source::BrowserWindow(id) => {
                let capturer = capturer.ok_or_else(|| {
                    Ended::Failed("no engine is connected to capture the browser window".into())
                })?;
                let capture = capturer
                    .start_browser_window(&id, MAX_FRAMERATE)
                    .map_err(Ended::Failed)?;
                self.pages.insert(
                    capture,
                    Page {
                        window: id,
                        ..Page::default()
                    },
                );
                Ok(Shows::BrowserWindow(capture))
            }
            Source::Monitor(name) => {
                let Some(target) = self.monitor(&name) else {
                    debug!(?stream, %name, "a cast of a monitor that is not plugged in");
                    return Err(Ended::SourceGone);
                };
                self.desk(stream, Some(name), target, capturer)
                    .map_err(Ended::Failed)
            }
            Source::Region(region) => {
                let target = (
                    region.position.0,
                    region.position.1,
                    region.size.0,
                    region.size.1,
                );
                self.desk(stream, None, target, capturer)
                    .map_err(Ended::Failed)
            }
        }
    }

    /// Takes a shot of `desk`, a rectangle of the desktop, under `stream`,
    /// naming the windows among `open` in it. `developed` hears it once every
    /// monitor it touches has a frame, or why it failed.
    fn shoot(
        &mut self,
        stream: StreamId,
        desk: Result<Rect, String>,
        open: Vec<Candidate>,
        developed: Developed,
        renderer: Option<&mut GlesRenderer>,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        let Some(capturer) = capturer else {
            developed(Err("no engine is connected to capture the desktop".into()));
            return;
        };
        match desk.and_then(|desk| self.frame_the_desk(stream, desk, capturer)) {
            Ok((desk, layout)) => {
                let (windows, descriptions) = named(open);
                self.shooting.push(Shooting {
                    stream,
                    desk,
                    layout,
                    windows,
                    descriptions,
                    developed,
                });
                self.develop(renderer, capturer);
            }
            Err(why) => developed(Err(why)),
        }
    }

    /// Takes a shot of browser window `id` alone, from a capture of its page.
    /// `developed` hears it with the capture's first frame, or why it failed.
    fn shoot_browser_window(
        &mut self,
        id: &str,
        developed: DevelopedWindow,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        let Some(capturer) = capturer else {
            developed(Err(
                "no engine is connected to capture the browser window".into()
            ));
            return;
        };
        match capturer.start_browser_window(id, MAX_FRAMERATE) {
            Ok(capture) => {
                self.browser_shots.insert(capture, developed);
            }
            Err(why) => developed(Err(why)),
        }
    }

    /// `desk` and its layout, with the captures a shot of it draws from
    /// running under `stream`.
    fn frame_the_desk(
        &mut self,
        stream: StreamId,
        desk: Rect,
        capturer: &mut (dyn Capturer + 'static),
    ) -> Result<(Rect, Layout), String> {
        let layout = region::layout(desk, &self.screens).map_err(|why| why.to_string())?;
        self.captures.show(
            stream,
            &self.capture_sizes(&layout),
            MAX_FRAMERATE,
            capturer,
        )?;
        Ok((desk, layout))
    }

    /// Finishes each shot whose monitors all have a frame, and lets its
    /// captures go.
    fn develop(
        &mut self,
        mut renderer: Option<&mut GlesRenderer>,
        capturer: &mut (dyn Capturer + 'static),
    ) {
        let mut index = 0;
        while index < self.shooting.len() {
            let shooting = &self.shooting[index];
            let shows = Shows::Desk {
                monitor: None,
                target: shooting.desk,
                layout: shooting.layout.clone(),
            };
            let composed = view(
                &shows,
                &self.shots,
                &self.captures,
                &self.pages,
                &self.screens,
                None,
                &EnginePointer::default(),
            )
            .map(|view| compose(view.size, &view.layers, renderer.as_deref_mut()));
            let Some(composed) = composed else {
                index += 1;
                continue;
            };
            let shooting = self.shooting.remove(index);
            self.captures.forget(shooting.stream, capturer);
            let scale = f64::from(shooting.layout.size.0) / f64::from(shooting.desk.2);
            let monitors = monitors(shooting.desk, scale, &self.screens, |name| {
                shooting.descriptions.get(name).cloned()
            });
            let windows = shooting.windows;
            (shooting.developed)(
                composed
                    .map(|shot| Desk {
                        shot,
                        monitors,
                        windows,
                        place: shooting.desk,
                    })
                    .map_err(|why| why.to_string()),
            );
        }
    }

    /// Ends `stream`, a stream or a shot, from this side.
    fn end_or_fail(
        &mut self,
        stream: StreamId,
        why: String,
        capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        match self
            .shooting
            .iter()
            .position(|shooting| shooting.stream == stream)
        {
            Some(index) => {
                let shooting = self.shooting.remove(index);
                if let Some(capturer) = capturer {
                    self.captures.forget(stream, capturer);
                }
                (shooting.developed)(Err(why));
            }
            None => self.end(stream, Ended::Failed(why), capturer),
        }
    }

    /// The size of a shot of `region` of monitor `name`, or all of it.
    pub fn monitor_shot_size(
        &self,
        name: &str,
        region: Option<Region>,
    ) -> Result<(u32, u32), String> {
        let part = self.monitor_part(name, region)?;
        let layout = region::layout(part, &self.screens).map_err(|why| why.to_string())?;
        Ok(layout.size)
    }

    /// The desktop rectangle of `region` of monitor `name`, cut at the
    /// monitor's edges, or all of the monitor.
    fn monitor_part(&self, name: &str, region: Option<Region>) -> Result<Rect, String> {
        let monitor = self
            .monitor(name)
            .ok_or_else(|| format!("monitor {name} is not plugged in"))?;
        match region {
            None => Ok(monitor),
            Some(Region { position, size }) => region::intersection(
                (
                    monitor.0 + position.0,
                    monitor.1 + position.1,
                    size.0,
                    size.1,
                ),
                monitor,
            )
            .ok_or_else(|| format!("the region is off monitor {name}")),
        }
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
                Some((piece.display, capture_size(screen)))
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
                    // Stopping releases the frame it holds. A capture the
                    // engine ended is gone already.
                    Some(Shows::BrowserWindow(capture)) => {
                        if let (Some(_), Some(capturer)) = (self.pages.remove(&capture), capturer) {
                            capturer.stop(capture);
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
        self.sizes
            .insert(frame.app_id.to_string(), frame.sampled.upright_size());
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
                        sampled: frame.sampled,
                        pixels_a_point: frame.pixels_a_point,
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
        let damage = damage_in_view(frame.damage, frame.sampled);
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
        if let Some(developed) = self.browser_shots.remove(&capture) {
            let shot = captured
                .map_err(|why| why.to_string())
                .and_then(|frame| shots::browser_window(&frame, renderer));
            // Stopping releases the frame, so only once it is read.
            capturer.stop(capture);
            developed(shot);
            return self.next_due();
        }
        if self.pages.contains_key(&capture) {
            self.page_drawn(capture, id, captured, renderer, capturer, now);
            return self.next_due();
        }
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
                    self.end_or_fail(stream, why.clone(), Some(&mut *capturer));
                }
                return self.next_due();
            }
        };
        let content = frame.content;
        let damage = frame.damage.unwrap_or(content);
        self.captures
            .keep(capture, id, Frame { snapshot, content }, kept, capturer);
        self.develop(renderer.as_deref_mut(), capturer);
        let Some(logical) = self
            .screens
            .iter()
            .find(|screen| screen.display == display)
            .map(|screen| (screen.desk.2, screen.desk.3))
        else {
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

    /// The stream that shows browser window capture `capture`, if one does.
    fn page_cast(&self, capture: CaptureId) -> Option<StreamId> {
        self.casts
            .iter()
            .find_map(|(&stream, cast)| match &cast.shows {
                Shows::BrowserWindow(shown) if *shown == capture => Some(stream),
                _ => None,
            })
    }

    /// Keeps frame `id` of `capture`, a page a stream shows, gives back the
    /// buffer the engine no longer needs to hold, and fills the stream.
    fn page_drawn(
        &mut self,
        capture: CaptureId,
        id: u64,
        captured: Result<CapturedFrame, String>,
        mut renderer: Option<&mut GlesRenderer>,
        capturer: &mut (dyn Capturer + 'static),
        now: Instant,
    ) {
        let stream = self
            .page_cast(capture)
            .expect("a page lives as long as its stream");
        let page = self.pages.get_mut(&capture).expect("checked by the caller");
        let kept = captured.map_err(|why| why.to_string()).and_then(|frame| {
            let (snapshot, kept) = captured::snapshot(&frame, renderer.as_deref_mut())
                .map_err(|why| why.to_string())?;
            Ok((frame, snapshot, kept))
        });
        let (frame, snapshot, kept) = match kept {
            Ok(kept) => kept,
            Err(why) => {
                capturer.release(capture, id);
                warn!(%why, "a browser window's captured frame could not be kept");
                self.end(stream, Ended::Failed(why), Some(capturer));
                return;
            }
        };
        let content = frame.content;
        let damage = within(frame.damage.unwrap_or(content), content);
        page.frame = Some(Frame { snapshot, content });
        let held = match kept {
            Kept::Copied => {
                capturer.release(capture, id);
                None
            }
            Kept::Sampled => Some(id),
        };
        if let Some(before) = std::mem::replace(&mut page.held, held) {
            capturer.release(capture, before);
        }
        self.offer(stream, damage.into_iter().collect(), renderer, now);
    }

    /// The engine stopped a capture. Its streams end.
    pub fn capture_ended(
        &mut self,
        capture: CaptureId,
        mut capturer: Option<&mut (dyn Capturer + 'static)>,
    ) {
        if let Some(developed) = self.browser_shots.remove(&capture) {
            developed(Err("the engine stopped capturing the browser window".into()));
        }
        for stream in self.captures.ended(capture) {
            self.end_or_fail(
                stream,
                "the engine stopped capturing the monitor".into(),
                capturer.as_deref_mut(),
            );
        }
        if let Some(stream) = self.page_cast(capture) {
            self.pages.remove(&capture);
            self.send(ToPipewire::End {
                stream,
                why: Ended::Failed("the engine stopped capturing the browser window".into()),
            });
        }
    }

    /// The engine was replaced, and its captures with it. Monitor and region
    /// streams end.
    pub fn engine_replaced(&mut self) {
        self.captures = Captures::default();
        self.pages.clear();
        for shooting in self.shooting.drain(..) {
            (shooting.developed)(Err("the engine was replaced".into()));
        }
        for (_, developed) in self.browser_shots.drain() {
            developed(Err("the engine was replaced".into()));
        }
        let captured: Vec<StreamId> = self
            .casts
            .iter()
            .filter(|(_, cast)| matches!(cast.shows, Shows::Desk { .. } | Shows::BrowserWindow(_)))
            .map(|(&stream, _)| stream)
            .collect();
        for stream in captured {
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
    /// Window streams that show it are damaged where it was and where it is.
    pub fn pointer_in_window(
        &mut self,
        at: Option<(String, (f64, f64))>,
        renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
        let before = std::mem::replace(&mut self.pointer, at);
        let engine_before = self.engine_pointer.clone();
        self.pointer_moved(before, engine_before, renderer, now)
    }

    /// The pointer moved to `at` on the desktop, or left it, over the pages of
    /// `windows`, as the engine reports it. Desk and browser window streams
    /// that show it are damaged where it was and where it is.
    pub fn pointer_on_desk(
        &mut self,
        at: Option<(f64, f64)>,
        windows: Vec<PointerOverWindow>,
        renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
        let engine_now = EnginePointer {
            desk: at,
            pages: windows
                .into_iter()
                .map(|window| (window.id, window.at))
                .collect(),
        };
        let engine_before = std::mem::replace(&mut self.engine_pointer, engine_now);
        let before = self.pointer.clone();
        self.pointer_moved(before, engine_before, renderer, now)
    }

    /// Damages the streams that show the pointer where it was, `before` in a
    /// window and `engine_before` as the engine reported it, and where it is.
    fn pointer_moved(
        &mut self,
        before: Option<(String, (f64, f64))>,
        engine_before: EnginePointer,
        mut renderer: Option<&mut GlesRenderer>,
        now: Instant,
    ) -> Option<Instant> {
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
                            .map(|(_, point)| in_window(*point, shot.pixels_a_point))
                            .collect::<Vec<_>>()
                    }
                    Shows::BrowserWindow(capture) => {
                        let page = self.pages.get(capture)?;
                        let size = page_size(page.frame.as_ref()?.content);
                        [&engine_before, &self.engine_pointer]
                            .into_iter()
                            .filter_map(|engine| on_page(engine, page, size))
                            .collect()
                    }
                    Shows::Desk { target, layout, .. } => {
                        [engine_before.desk, self.engine_pointer.desk]
                            .into_iter()
                            .flatten()
                            .filter_map(|point| on_desk(point, *target, layout))
                            .collect()
                    }
                };
                let size = view_size(&cast.shows, &self.shots, &self.pages)?;
                let sprite = at_density(&self.sprite, density(&cast.shows, &self.shots));
                let damage: Vec<Rect> = places
                    .into_iter()
                    .filter_map(|(x, y)| {
                        let (width, height) = sprite.size;
                        within(
                            (
                                x.round() as i32 - sprite.hotspot.0,
                                y.round() as i32 - sprite.hotspot.1,
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

    /// The windows a stream shows.
    pub fn windows(&self) -> HashSet<String> {
        self.casts
            .values()
            .filter_map(|cast| match &cast.shows {
                Shows::Window(app_id) => Some(app_id.clone()),
                Shows::BrowserWindow(_) | Shows::Desk { .. } => None,
            })
            .collect()
    }

    /// Window `app_id` showed `frame`, which a shot of it alone reads.
    pub fn shown(&mut self, app_id: &str, frame: Shown) {
        self.shown.insert(app_id.to_string(), frame);
    }

    /// A window closed: its streams end.
    pub fn window_gone(&mut self, app_id: &str) {
        self.sizes.remove(app_id);
        self.shown.remove(app_id);
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
            &self.pages,
            &self.screens,
            self.pointer.as_ref(),
            &self.engine_pointer,
        ) else {
            return;
        };
        let sprite = at_density(&self.sprite, density(&cast.shows, &self.shots));
        match step(stream, cast, &view, damage, &sprite, renderer, now) {
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

/// The windows among `open`, as a shot names them, and each monitor's
/// description by name.
fn named(open: Vec<Candidate>) -> (Vec<ShotWindow>, HashMap<String, String>) {
    let mut windows = Vec::new();
    let mut descriptions = HashMap::new();
    for candidate in open {
        match candidate.source {
            Source::Window(id) => windows.push(ShotWindow {
                id,
                title: candidate.title,
                app_id: candidate.app_id,
            }),
            Source::Monitor(name) => {
                descriptions.insert(name, candidate.title);
            }
            Source::BrowserWindow(_) | Source::Region(_) => {}
        }
    }
    (windows, descriptions)
}

/// The size of a browser window's stream: the part of its capture's frame
/// that is the page. Viz letterboxes a page that changed size into the
/// capture's size, so the stream keeps the page's shape.
fn page_size(content: Rect) -> (u32, u32) {
    (content.2 as u32, content.3 as u32)
}

/// The size of a screen's capture: its logical size at its density, upright.
fn capture_size(screen: &Screen) -> (u32, u32) {
    (
        (f64::from(screen.desk.2) * screen.scale).round() as u32,
        (f64::from(screen.desk.3) * screen.scale).round() as u32,
    )
}

/// A point in a window's box, in frame pixels.
fn in_window(point: (f64, f64), pixels_a_point: (f64, f64)) -> (f64, f64) {
    (point.0 * pixels_a_point.0, point.1 * pixels_a_point.1)
}

/// How many stream pixels a logical pixel of what `shows` shows is. A
/// browser window's page is in CSS pixels, which its stream is the size of.
fn density(shows: &Shows, shots: &HashMap<String, Shot>) -> f64 {
    match shows {
        Shows::Window(app_id) => shots.get(app_id).map_or(1.0, |shot| shot.pixels_a_point.0),
        Shows::BrowserWindow(_) => 1.0,
        Shows::Desk { target, layout, .. } => f64::from(layout.size.0) / f64::from(target.2),
    }
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
/// A commit's `damage` in the frame of a window cast showing `sampled`.
///
/// Damage is not mapped through a turn, so a turned window damages its whole
/// frame, as it does in the engine.
fn damage_in_view(damage: Option<Rect>, sampled: Sampled) -> Vec<Rect> {
    if sampled.transform == Transform::Normal {
        damage
            .and_then(|damage| within(damage, sampled.crop))
            .map_or_else(Vec::new, |damage| vec![damage])
    } else {
        let (width, height) = sampled.upright_size();
        vec![(0, 0, width as i32, height as i32)]
    }
}

fn view_size(
    shows: &Shows,
    shots: &HashMap<String, Shot>,
    pages: &HashMap<CaptureId, Page>,
) -> Option<(u32, u32)> {
    match shows {
        Shows::Window(app_id) => shots.get(app_id).map(|shot| shot.sampled.upright_size()),
        Shows::BrowserWindow(capture) => pages
            .get(capture)?
            .frame
            .as_ref()
            .map(|frame| page_size(frame.content)),
        Shows::Desk { layout, .. } => Some(layout.size),
    }
}

/// Where `engine` puts the pointer over `page`, `size` stream pixels, or
/// `None` off it.
fn on_page(engine: &EnginePointer, page: &Page, size: (u32, u32)) -> Option<(f64, f64)> {
    let (x, y) = engine.pages.get(&page.window)?;
    Some((x * f64::from(size.0), y * f64::from(size.1)))
}

/// What a stream's next frame is made of, or `None` until every source it
/// draws from has drawn.
fn view<'a>(
    shows: &Shows,
    shots: &'a HashMap<String, Shot>,
    captures: &'a Captures,
    pages: &'a HashMap<CaptureId, Page>,
    screens: &[Screen],
    pointer: Option<&(String, (f64, f64))>,
    engine_pointer: &EnginePointer,
) -> Option<View<'a>> {
    match shows {
        Shows::Window(app_id) => {
            let shot = shots.get(app_id)?;
            Some(View {
                size: shot.sampled.upright_size(),
                layers: vec![Layer::upright(&shot.snapshot, shot.sampled)],
                pointer: pointer
                    .filter(|(id, _)| id == app_id)
                    .map(|(_, point)| in_window(*point, shot.pixels_a_point)),
            })
        }
        Shows::BrowserWindow(capture) => {
            let page = pages.get(capture)?;
            let frame = page.frame.as_ref()?;
            let size = page_size(frame.content);
            Some(View {
                size,
                layers: vec![Layer {
                    snapshot: &frame.snapshot,
                    from: frame.content,
                    to: (0, 0, size.0 as i32, size.1 as i32),
                    transform: Transform::Normal,
                }],
                pointer: on_page(engine_pointer, page, size),
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
                        transform: Transform::Normal,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(View {
                size: layout.size,
                layers,
                pointer: engine_pointer
                    .desk
                    .and_then(|point| on_desk(point, *target, layout)),
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
    renderer: Option<&mut GlesRenderer>,
) -> Result<Option<OwnedFd>, FillError> {
    match target {
        Target::Shm(mapping) => {
            let (stride, _) = shm_layout(format.size);
            let stride = stride as usize;
            // SAFETY: the buffer is lent to this thread until it is sent.
            let bytes = unsafe { mapping.bytes() };
            paint(layers, bytes, stride, format.pixel, renderer)?;
            if let Plan::Embed { at } = cursor {
                embed(bytes, stride, format.size, sprite, at);
            }
            Ok(None)
        }
        Target::Dmabuf(dmabuf) => gpu::draw(
            renderer.ok_or(FillError::NoGpu)?,
            layers,
            dmabuf,
            (dmabuf.width(), dmabuf.height()),
            cursor,
            sprite,
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use std::io::Write as _;
    use std::os::fd::{FromRawFd as _, OwnedFd};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::Instant;

    use smithay::reexports::calloop::channel::channel;

    use domicile_protocol::{PointerOverWindow, ShotWindow};

    use smithay::utils::Transform;

    use super::{damage_in_view, density, view, Cast, EnginePointer, Shot, Shows, Streams};
    use crate::buffer_transform::Sampled;
    use crate::casting::captures::Capturer;
    use crate::casting::cursor::{CursorMode, Plan};
    use crate::casting::gpu::Snapshot;
    use crate::casting::lifecycle::Ended;
    use crate::casting::pacing::Rect;
    use crate::casting::producer::ToWayland;
    use crate::casting::region;
    use crate::casting::region::Screen;
    use crate::casting::shots::Desk;
    use crate::casting::{Candidate, Region, Request, Source, StreamId};
    use crate::engine::{CaptureId, CapturedFrame, CapturedPixels, SharedFd};

    /// An engine that numbers captures by display, captures browser windows
    /// as 100, and records stops and releases.
    #[derive(Default)]
    struct Engine {
        started: Vec<i64>,
        sizes: Vec<(u32, u32)>,
        browser_windows: Vec<String>,
        stopped: Vec<CaptureId>,
        released: Vec<(CaptureId, u64)>,
    }

    /// The capture [`Engine`] starts for a browser window.
    const BROWSER_WINDOW: CaptureId = 100;

    impl Capturer for Engine {
        fn start(&mut self, display: i64, size: (u32, u32), _: u32) -> Result<CaptureId, String> {
            self.started.push(display);
            self.sizes.push(size);
            Ok(display as CaptureId)
        }
        fn start_browser_window(&mut self, window: &str, _: u32) -> Result<CaptureId, String> {
            self.browser_windows.push(window.into());
            Ok(BROWSER_WINDOW)
        }
        fn resize(&mut self, _: CaptureId, _: (u32, u32)) {}
        fn stop(&mut self, capture: CaptureId) {
            self.stopped.push(capture);
        }
        fn release(&mut self, capture: CaptureId, frame: u64) {
            self.released.push((capture, frame));
        }
    }

    /// A 1x1 monitor at 1x, and a 1x1 one at 2x to its right.
    fn screens() -> Vec<Screen> {
        vec![
            Screen {
                name: "drm-1".into(),
                display: 1,
                desk: (0, 0, 1, 1),
                scale: 1.0,
            },
            Screen {
                name: "drm-2".into(),
                display: 2,
                desk: (1, 0, 1, 1),
                scale: 2.0,
            },
        ]
    }

    /// A shared memory frame of `size`, every pixel `[blue, 0, 0, 255]`.
    fn frame(size: (u32, u32), blue: u8) -> CapturedFrame {
        painted(size, &vec![blue; (size.0 * size.1) as usize])
    }

    /// A shared memory frame of `size`, each pixel `[blue, 0, 0, 255]` with
    /// its blue byte from `blues`, row by row.
    fn painted(size: (u32, u32), blues: &[u8]) -> CapturedFrame {
        // SAFETY: a fresh memfd, owned here.
        let fd = unsafe { libc::memfd_create(c"frame".as_ptr(), 0) };
        assert!(fd >= 0, "a memfd");
        // SAFETY: `fd` is open and owned by nothing else.
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };
        let pixels: Vec<u8> = blues.iter().flat_map(|&blue| [blue, 0, 0, 255]).collect();
        std::fs::File::from(fd.try_clone().expect("a duplicate"))
            .write_all(&pixels)
            .expect("written");
        CapturedFrame {
            pixels: CapturedPixels::Shm {
                fd: SharedFd(Arc::new(fd)),
                stride: size.0 * 4,
            },
            size,
            // DRM_FORMAT_ARGB8888.
            fourcc: 0x3432_5241,
            content: (0, 0, size.0 as i32, size.1 as i32),
            damage: None,
        }
    }

    fn streams() -> Streams {
        let mut streams = Streams::new(channel().0, None);
        streams.screens(screens(), None);
        streams
    }

    /// The engine says where the pointer is on the desk; the page says where
    /// it is in a window. Each keeps the other.
    /// A cast draws the pointer at its source's density: a 2x monitor's
    /// stream has two pixels a logical pixel, a 1x one has one.
    #[test]
    fn a_cast_draws_the_pointer_at_its_sources_density() {
        let desk = |target: Rect| Shows::Desk {
            monitor: None,
            target,
            layout: region::layout(target, &screens()).expect("on a monitor"),
        };

        assert_eq!(density(&desk((0, 0, 1, 1)), &HashMap::new()), 1.0);
        assert_eq!(density(&desk((1, 0, 1, 1)), &HashMap::new()), 2.0);
        assert_eq!(density(&Shows::BrowserWindow(1), &HashMap::new()), 1.0);
    }

    /// A fractionally scaled window's buffer has a fractional number of
    /// pixels a point, so the pointer and the arrow scale by it.
    #[test]
    fn a_window_cast_puts_the_pointer_at_its_buffers_pixels_a_point() {
        let mut streams = streams();
        streams.shots.insert(
            "app-1".into(),
            Shot {
                snapshot: Snapshot::Pixels {
                    bytes: vec![0; 175 * 105 * 4],
                    stride: 175 * 4,
                    alpha: false,
                    size: (175, 105),
                },
                sampled: Sampled {
                    crop: (0, 0, 175, 105),
                    transform: Transform::Normal,
                },
                pixels_a_point: (1.75, 1.75),
            },
        );
        let shows = Shows::Window("app-1".into());

        let shown = view(
            &shows,
            &streams.shots,
            &streams.captures,
            &streams.pages,
            &streams.screens,
            Some(&("app-1".into(), (10.0, 20.0))),
            &EnginePointer::default(),
        )
        .expect("a frame to show");
        assert_eq!(shown.pointer, Some((17.5, 35.0)));
        assert_eq!(density(&shows, &streams.shots), 1.75);
    }

    #[test]
    fn the_pointer_on_the_desk_and_in_a_window_are_heard_apart() {
        let mut streams = streams();
        let now = Instant::now();

        streams.pointer_in_window(Some(("app-1".into(), (2.0, 3.0))), None, now);
        streams.pointer_on_desk(Some((40.0, 50.0)), Vec::new(), None, now);

        assert_eq!(streams.pointer, Some(("app-1".into(), (2.0, 3.0))));
        assert_eq!(streams.engine_pointer.desk, Some((40.0, 50.0)));
        streams.pointer_in_window(None, None, now);
        assert_eq!(streams.engine_pointer.desk, Some((40.0, 50.0)));
    }

    #[test]
    fn a_shot_waits_for_every_monitor_then_lets_their_captures_go() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let (developed, heard) = mpsc::channel();
        let open = vec![
            Candidate {
                source: Source::Window("app-3".into()),
                title: "~/src".into(),
                app_id: "kitty".into(),
                bounds: None,
            },
            Candidate {
                source: Source::Monitor("drm-1".into()),
                title: "BOE NE135A1M-NY1".into(),
                app_id: String::new(),
                bounds: Some(Region {
                    position: (0, 0),
                    size: (1, 1),
                }),
            },
        ];

        streams.request(
            Request::Shoot {
                stream: StreamId(9),
                developed: Box::new(move |desk| developed.send(desk).expect("heard")),
            },
            || open,
            None,
            Some(&mut engine),
        );
        assert_eq!(engine.started, [1, 2]);
        streams.captured(
            1,
            1,
            Ok(frame((1, 1), 10)),
            None,
            &mut engine,
            Instant::now(),
        );
        assert!(heard.try_recv().is_err(), "drm-2 has no frame yet");
        streams.captured(
            2,
            1,
            Ok(frame((2, 2), 20)),
            None,
            &mut engine,
            Instant::now(),
        );

        let desk: Desk = heard.try_recv().expect("developed").expect("a desk");
        let blue: Vec<u8> = desk.shot.bgra.chunks(4).map(|pixel| pixel[0]).collect();
        assert_eq!(blue, [10, 10, 20, 20, 10, 10, 20, 20]);
        assert_eq!(
            desk.monitors
                .iter()
                .map(|monitor| (monitor.name.as_str(), monitor.description.as_str()))
                .collect::<Vec<_>>(),
            [("drm-1", "BOE NE135A1M-NY1"), ("drm-2", "")]
        );
        assert_eq!(
            desk.windows,
            [ShotWindow {
                id: "app-3".into(),
                title: "~/src".into(),
                app_id: "kitty".into(),
            }],
            "the windows, not the monitors"
        );
        assert_eq!(desk.place, (0, 0, 2, 1));
        engine.stopped.sort_unstable();
        assert_eq!(engine.stopped, [1, 2]);
    }

    #[test]
    fn a_shot_of_one_monitor_draws_from_its_capture_alone_at_its_density() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let (developed, heard) = mpsc::channel();

        streams.request(
            Request::ShootMonitor {
                stream: StreamId(9),
                name: "drm-2".into(),
                region: None,
                developed: Box::new(move |desk| developed.send(desk).expect("heard")),
            },
            Vec::new,
            None,
            Some(&mut engine),
        );
        assert_eq!(engine.started, [2]);
        streams.captured(
            2,
            1,
            Ok(frame((2, 2), 20)),
            None,
            &mut engine,
            Instant::now(),
        );

        let desk: Desk = heard.try_recv().expect("developed").expect("a desk");
        let blue: Vec<u8> = desk.shot.bgra.chunks(4).map(|pixel| pixel[0]).collect();
        assert_eq!(blue, [20, 20, 20, 20]);
        assert_eq!(desk.place, (1, 0, 1, 1));
        assert_eq!(engine.stopped, [2]);
    }

    #[test]
    fn a_rotated_monitors_shot_is_captured_upright() {
        let mut streams = Streams::new(channel().0, None);
        streams.screens(
            vec![Screen {
                name: "drm-1".into(),
                display: 1,
                desk: (0, 0, 1, 2),
                scale: 1.0,
            }],
            None,
        );
        let mut engine = Engine::default();
        let (developed, heard) = mpsc::channel();

        streams.request(
            Request::ShootMonitor {
                stream: StreamId(9),
                name: "drm-1".into(),
                region: None,
                developed: Box::new(move |desk| developed.send(desk).expect("heard")),
            },
            Vec::new,
            None,
            Some(&mut engine),
        );
        // viz renders a turned window upright and turns it on the way to the
        // panel, so its capture is the upright frame.
        assert_eq!(engine.sizes, [(1, 2)]);
        streams.captured(
            1,
            1,
            Ok(painted((1, 2), &[10, 20])),
            None,
            &mut engine,
            Instant::now(),
        );

        let desk: Desk = heard.try_recv().expect("developed").expect("a desk");
        let blue: Vec<u8> = desk.shot.bgra.chunks(4).map(|pixel| pixel[0]).collect();
        assert_eq!((desk.shot.width, desk.shot.height), (1, 2));
        assert_eq!(blue, [10, 20]);
    }

    #[test]
    fn a_monitor_shot_is_the_monitors_size_at_its_density_clipped_to_it() {
        let streams = streams();
        let region = |x, y, width, height| {
            Some(Region {
                position: (x, y),
                size: (width, height),
            })
        };

        assert_eq!(streams.monitor_shot_size("drm-2", None), Ok((2, 2)));
        assert_eq!(
            streams.monitor_shot_size("drm-1", region(0, 0, 5, 5)),
            Ok((1, 1)),
            "a region past the monitor's edge is cut at it"
        );
        assert!(streams
            .monitor_shot_size("drm-1", region(1, 0, 1, 1))
            .is_err());
        assert!(streams.monitor_shot_size("drm-3", None).is_err());
    }

    #[test]
    fn a_window_that_has_shown_nothing_cannot_be_shot_alone() {
        let (developed, heard) = mpsc::channel();

        streams().request(
            Request::ShootWindow {
                app_id: "app-3".into(),
                developed: Box::new(move |shot| developed.send(shot).expect("heard")),
            },
            Vec::new,
            None,
            None,
        );

        assert!(heard.try_recv().expect("developed").is_err());
    }

    #[test]
    fn a_shot_without_an_engine_is_refused() {
        let (developed, heard) = mpsc::channel();

        streams().shoot(
            StreamId(9),
            Ok((0, 0, 2, 1)),
            Vec::new(),
            Box::new(move |desk| developed.send(desk).expect("heard")),
            None,
            None,
        );

        assert!(heard.try_recv().expect("developed").is_err());
    }

    #[test]
    fn a_shot_fails_when_the_engine_stops_a_capture_it_waits_on() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let (developed, heard) = mpsc::channel();
        streams.shoot(
            StreamId(9),
            Ok((0, 0, 2, 1)),
            Vec::new(),
            Box::new(move |desk| developed.send(desk).expect("heard")),
            None,
            Some(&mut engine),
        );

        streams.capture_ended(2, Some(&mut engine));

        assert!(heard.try_recv().expect("developed").is_err());
        assert_eq!(engine.stopped, [1]);
    }

    #[test]
    fn a_browser_window_is_shot_alone_from_its_captures_first_frame() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let (developed, heard) = mpsc::channel();
        streams.request(
            Request::ShootBrowserWindow {
                id: "1".into(),
                developed: Box::new(move |shot| developed.send(shot).expect("heard")),
            },
            Vec::new,
            None,
            Some(&mut engine),
        );
        assert_eq!(engine.browser_windows, ["1"]);
        assert!(heard.try_recv().is_err(), "no shot before a frame");

        // Viz letterboxes the page into the frame; only `content` is it.
        let mut letterboxed = painted((3, 2), &[0, 1, 2, 0, 3, 4]);
        letterboxed.content = (1, 0, 2, 2);
        streams.captured(
            BROWSER_WINDOW,
            1,
            Ok(letterboxed),
            None,
            &mut engine,
            Instant::now(),
        );

        let shot = heard.try_recv().expect("developed").expect("shot");
        assert_eq!((shot.width, shot.height), (2, 2));
        let blue: Vec<u8> = shot.bgra.chunks(4).map(|pixel| pixel[0]).collect();
        assert_eq!(blue, [1, 2, 3, 4]);
        assert_eq!(engine.stopped, [BROWSER_WINDOW]);
    }

    #[test]
    fn a_browser_window_shot_fails_when_the_engine_stops_its_capture() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let (developed, heard) = mpsc::channel();
        streams.request(
            Request::ShootBrowserWindow {
                id: "1".into(),
                developed: Box::new(move |shot| developed.send(shot).expect("heard")),
            },
            Vec::new,
            None,
            Some(&mut engine),
        );

        streams.capture_ended(BROWSER_WINDOW, Some(&mut engine));

        assert!(heard.try_recv().expect("developed").is_err());
    }

    /// The compositor cannot see the pointer over a page; the engine says
    /// where on each window's page it is.
    #[test]
    fn a_browser_window_cast_draws_the_pointer_where_the_engine_puts_it() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let shows = streams
            .shows(
                StreamId(4),
                Source::BrowserWindow("1".into()),
                |_| false,
                Some(&mut engine),
            )
            .expect("a browser window cast");
        streams.casts.insert(StreamId(4), cast(shows));
        streams.captured(
            BROWSER_WINDOW,
            7,
            Ok(frame((4, 2), 0)),
            None,
            &mut engine,
            Instant::now(),
        );
        let pointer = |streams: &Streams| {
            view(
                &streams.casts[&StreamId(4)].shows,
                &streams.shots,
                &streams.captures,
                &streams.pages,
                &streams.screens,
                None,
                &streams.engine_pointer,
            )
            .expect("a frame to show")
            .pointer
        };

        streams.pointer_on_desk(
            Some((40.0, 50.0)),
            vec![PointerOverWindow {
                id: "1".into(),
                at: (0.5, 0.25),
            }],
            None,
            Instant::now(),
        );
        assert_eq!(pointer(&streams), Some((2.0, 0.5)));

        streams.pointer_on_desk(
            Some((40.0, 50.0)),
            vec![PointerOverWindow {
                id: "2".into(),
                at: (0.5, 0.25),
            }],
            None,
            Instant::now(),
        );
        assert_eq!(pointer(&streams), None, "over another window");
    }

    #[test]
    fn a_browser_window_cast_shows_its_page_alone_from_its_own_capture() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let shows = streams
            .shows(
                StreamId(4),
                Source::BrowserWindow("1".into()),
                |_| false,
                Some(&mut engine),
            )
            .expect("a browser window cast");
        streams.casts.insert(StreamId(4), cast(shows));
        assert_eq!(engine.browser_windows, ["1"]);

        // Viz letterboxes the page into the frame; only `content` is it.
        let mut letterboxed = painted((3, 2), &[0, 1, 2, 0, 3, 4]);
        letterboxed.content = (1, 0, 2, 2);
        streams.captured(
            BROWSER_WINDOW,
            7,
            Ok(letterboxed),
            None,
            &mut engine,
            Instant::now(),
        );

        let shown = view(
            &streams.casts[&StreamId(4)].shows,
            &streams.shots,
            &streams.captures,
            &streams.pages,
            &streams.screens,
            None,
            &EnginePointer::default(),
        )
        .expect("a frame to show");
        assert_eq!(shown.size, (2, 2));
        assert_eq!(shown.layers.len(), 1);
        assert_eq!(
            (shown.layers[0].from, shown.layers[0].to),
            ((1, 0, 2, 2), (0, 0, 2, 2))
        );
        assert_eq!(
            engine.released,
            [(BROWSER_WINDOW, 7)],
            "a copied frame goes back at once"
        );
    }

    #[test]
    fn a_browser_window_casts_capture_stops_with_it() {
        let (mut streams, mut engine) = (streams(), Engine::default());
        let shows = streams
            .shows(
                StreamId(4),
                Source::BrowserWindow("1".into()),
                |_| false,
                Some(&mut engine),
            )
            .expect("a browser window cast");
        streams.casts.insert(StreamId(4), cast(shows));

        streams.news(
            ToWayland::Ended {
                stream: StreamId(4),
            },
            None,
            Some(&mut engine),
            Instant::now(),
        );

        assert_eq!(engine.stopped, [BROWSER_WINDOW]);
    }

    #[test]
    fn a_browser_window_cast_without_an_engine_fails() {
        assert!(matches!(
            streams().shows(
                StreamId(4),
                Source::BrowserWindow("1".into()),
                |_| false,
                None,
            ),
            Err(Ended::Failed(_))
        ));
    }

    #[test]
    fn a_turned_windows_damage_is_its_whole_frame() {
        let upright = Sampled {
            crop: (10, 0, 30, 20),
            transform: Transform::Normal,
        };
        assert_eq!(damage_in_view(Some((15, 5, 2, 2)), upright), [(5, 5, 2, 2)]);
        let turned = Sampled {
            transform: Transform::_90,
            ..upright
        };
        assert_eq!(
            damage_in_view(Some((15, 5, 2, 2)), turned),
            [(0, 0, 20, 30)]
        );
    }

    #[test]
    fn each_window_a_cast_shows_is_named_once() {
        let mut streams = streams();
        for (stream, window) in [(1, "term"), (2, "term"), (3, "editor")] {
            streams
                .casts
                .insert(StreamId(stream), cast(Shows::Window(window.into())));
        }

        assert_eq!(
            streams.windows(),
            HashSet::from(["term".to_string(), "editor".to_string()])
        );
    }

    /// A stream of `shows` that has not negotiated.
    fn cast(shows: Shows) -> Cast {
        Cast {
            shows,
            cursor: CursorMode::Hidden,
            format: None,
            pacing: None,
            targets: HashMap::new(),
            filling: false,
            asked: (1, 1),
            cursor_plan: Plan::Nothing,
        }
    }
}
