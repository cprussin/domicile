//! Screen casting: PipeWire video streams of windows, monitors and regions.
//!
//! [`Casting`] is the API the ScreenCast portal calls. It starts a stream of a
//! [`Source`], reports the stream's PipeWire node, and reports when it ends.
//!
//! Three threads take part:
//!
//! - The caller's, which may be any. [`Casting`] only queues requests.
//! - The Wayland thread, which owns the windows and the engine. It routes
//!   each request, checks the source exists, and fills stream buffers from
//!   the window's committed buffers or the engine's display captures (see
//!   [`streams`]).
//! - The PipeWire thread, which owns the streams, their buffers and the
//!   negotiation (see [`producer`]). It lends empty buffers to the Wayland
//!   thread and queues the ones it fills.
//!
//! Neither thread waits on the other: both directions are queues. See
//! `docs/PORTALS.md`.
//!
//! A monitor or region is filled from the engine's display captures; see
//! [`captures`] and [`region`]. [`Casting::list`] lists what can be cast as
//! [`Candidate`]s. A shot of the whole desk, for the Screenshot portal, draws
//! from the same captures; see [`shots`].

mod captured;
mod captures;
mod cursor;
mod gpu;
mod lifecycle;
mod memory;
mod negotiation;
mod pacing;
mod paint;
mod params;
mod producer;
mod region;
mod shm_copy;
mod shots;
mod streams;
mod test_pattern;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use smithay::reexports::calloop::channel::Sender;

use crate::reply::{reply, Replier, Reply};

pub use captures::Capturer;
pub use cursor::CursorMode;
pub use lifecycle::Ended;
pub use producer::ToWayland;
pub use region::Screen;
pub use shots::{Desk, Developed, DevelopedWindow, Shown};
pub use streams::{Committed, Gpu, Streams};
pub use test_pattern::TestPattern;

/// What a stream shows.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    /// A window, by its host app id.
    Window(String),
    /// A monitor, by its `wl_output` name, at its own density.
    Monitor(String),
    /// A rectangle of the desktop, at the highest density it touches.
    Region(Region),
}

/// A rectangle of the desktop, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Region {
    pub position: (i32, i32),
    pub size: (i32, i32),
}

/// A source that can be cast now, as a picker lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub source: Source,
    /// A window's title, empty until the client names it, or a monitor's
    /// make, model and serial, empty when unknown.
    pub title: String,
    /// A window's client app id (`xdg_toplevel.set_app_id`), which names its
    /// desktop entry. Empty when the client set none.
    pub app_id: String,
    /// Where it is on the desktop, and its size, in logical pixels. `None`
    /// before the page has placed it.
    pub bounds: Option<Region>,
}

/// One stream, as long as it lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StreamId(u64);

/// What a stream's caller hears.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    /// The stream's PipeWire node, for the consumer to connect to.
    Ready { node: u32 },
    /// The stream is gone. Nothing follows.
    Ended(Ended),
}

/// Hears a stream's events. Called on the Wayland or PipeWire thread, so it
/// must not block.
pub type Listener = Box<dyn FnMut(Event) + Send>;

/// A request on its way to the Wayland thread.
pub enum Request {
    Start {
        stream: StreamId,
        source: Source,
        cursor: CursorMode,
        listener: Listener,
    },
    Stop {
        stream: StreamId,
    },
    /// What can be cast now.
    List {
        reply: Replier<Vec<Candidate>>,
    },
    /// One frame of the whole desk, taken under `stream`.
    Shoot {
        stream: StreamId,
        developed: Developed,
    },
    /// One frame of monitor `name` at its own density, taken under
    /// `stream`. `region` is a part of it, in logical pixels from its
    /// corner; `None` for all of it.
    ShootMonitor {
        stream: StreamId,
        name: String,
        region: Option<Region>,
        developed: Developed,
    },
    /// The last frame the window `app_id` showed, alone.
    ShootWindow {
        app_id: String,
        developed: DevelopedWindow,
    },
}

/// Starts and stops streams. Cheap to clone, and usable from any thread.
#[derive(Clone)]
pub struct Casting {
    requests: Sender<Request>,
    next: Arc<AtomicU64>,
}

impl Casting {
    /// A handle that queues requests to the Wayland thread.
    pub fn new(requests: Sender<Request>) -> Self {
        Self {
            requests,
            next: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Starts a stream of `source`. `listener` makes the stream's listener
    /// from its id, before the stream can end; the listener hears `Ready`
    /// with the node, then `Ended` once.
    pub fn start(
        &self,
        source: Source,
        cursor: CursorMode,
        listener: impl FnOnce(StreamId) -> Listener,
    ) -> StreamId {
        let stream = StreamId(self.next.fetch_add(1, Ordering::Relaxed));
        self.send(Request::Start {
            stream,
            source,
            cursor,
            listener: listener(stream),
        });
        stream
    }

    /// Stops `stream`. Its listener hears `Ended(Stopped)`, unless it had
    /// already ended.
    pub fn stop(&self, stream: StreamId) {
        self.send(Request::Stop { stream });
    }

    /// What can be cast now: the windows, in the order they opened, then the
    /// monitors. A region is any rectangle, so none is listed.
    pub fn list(&self) -> Reply<Vec<Candidate>> {
        let (replier, listed) = reply();
        self.send(Request::List { reply: replier });
        listed
    }

    /// Takes one frame of the whole desk. `developed` hears it, or why
    /// there is none.
    pub fn shoot(&self, developed: Developed) {
        let stream = StreamId(self.next.fetch_add(1, Ordering::Relaxed));
        self.send(Request::Shoot { stream, developed });
    }

    /// Takes one frame of `region` of monitor `name`, or all of it, at the
    /// monitor's density. `developed` hears it, or why there is none.
    pub fn shoot_monitor(&self, name: String, region: Option<Region>, developed: Developed) {
        let stream = StreamId(self.next.fetch_add(1, Ordering::Relaxed));
        self.send(Request::ShootMonitor {
            stream,
            name,
            region,
            developed,
        });
    }

    /// Takes the last frame window `app_id` showed. `developed` hears it, or
    /// why there is none.
    pub fn shoot_window(&self, app_id: String, developed: DevelopedWindow) {
        self.send(Request::ShootWindow { app_id, developed });
    }

    fn send(&self, request: Request) {
        self.requests
            .send(request)
            .expect("the Wayland thread outlives every casting handle");
    }
}

impl Source {
    /// A monitor named `spec`, or the region `spec` spells as
    /// `<x>,<y>,<width>x<height>` in logical pixels.
    pub fn desk(spec: &str) -> Source {
        let region = || {
            let (x, rest) = spec.split_once(',')?;
            let (y, size) = rest.split_once(',')?;
            let (width, height) = size.split_once('x')?;
            Some(Region {
                position: (x.parse().ok()?, y.parse().ok()?),
                size: (width.parse().ok()?, height.parse().ok()?),
            })
        };
        region().map_or_else(|| Source::Monitor(spec.to_string()), Source::Region)
    }
}

#[cfg(test)]
mod tests {
    use super::{Region, Source};

    #[test]
    fn a_desk_source_is_a_region_when_it_spells_one_and_a_monitor_otherwise() {
        assert_eq!(
            Source::desk("1800,-20,240x100"),
            Source::Region(Region {
                position: (1800, -20),
                size: (240, 100),
            })
        );
        assert_eq!(Source::desk("drm-2"), Source::Monitor("drm-2".into()));
        assert_eq!(Source::desk("1,2,3"), Source::Monitor("1,2,3".into()));
    }
}
