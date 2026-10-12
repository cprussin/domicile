//! The compositor's connection to the engine: the loaded library, the surfaces
//! brokered through it, and the client buffers it holds.
//!
//! [`crate::engine`] is the ABI; this module uses it.

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use crate::buffer_transform::Sampled;
use crate::dmabuf_descriptor::DmabufDescriptor;
use domicile_host::clipboard::Contents;
use smithay::reexports::wayland_server::backend::ObjectId;
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::reexports::wayland_server::Resource as _;

use crate::engine::{
    BufferId, Capture, Clipboard, Connector, Dmabuf, Engine, EngineError, Event, Request,
    SurfaceId, LIBRARY, NEWEST_BOX,
};
use crate::engine_buffers::{HeldBuffers, Returned};
use crate::engine_imports::{Imports, Route, Then};
use crate::engine_surfaces::Surfaces;
use crate::engine_waiting::Waiting;
use crate::uploads::UploadId;

/// A buffer submitted to the engine: a client's dmabuf, or a compositor buffer
/// holding a copied shm frame.
///
/// Both are held until viz releases them. A client buffer then gets a
/// `wl_buffer.release`; an upload goes back to [`crate::uploads::Uploads`].
#[derive(Debug, Clone, PartialEq)]
pub enum Submitted {
    Client(wl_buffer::WlBuffer),
    Upload(UploadId),
}

/// The key an import is recorded under.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum ImportKey {
    Client(ObjectId),
    Upload(UploadId),
}

impl Submitted {
    fn key(&self) -> ImportKey {
        match self {
            Submitted::Client(buffer) => ImportKey::Client(buffer.id()),
            Submitted::Upload(id) => ImportKey::Upload(*id),
        }
    }
}

/// What became of a frame handed to [`EngineSession::submit`].
#[derive(Debug, PartialEq)]
pub enum Submission {
    /// Viz has it. The caller must not release the buffer, and must release
    /// `replaced`, an older frame that was waiting.
    Taken { replaced: Option<Submitted> },
    /// The frame waits for a page to embed the surface (see
    /// `engine_waiting`) or for its buffer's import (see `engine_imports`).
    /// The caller must not release the buffer, and must release `replaced`.
    Waiting { replaced: Option<Submitted> },
    /// Nothing was submitted; the buffer is still the caller's.
    Refused,
}

/// A frame waiting to be submitted.
#[derive(Debug)]
struct Frame {
    buffer: Submitted,
    descriptor: DmabufDescriptor,
    sampled: Sampled,
    at_box: u64,
}

/// What became of a frame handed to [`EngineSession::put_up`].
enum PutUp {
    /// As [`Submission::Taken`].
    Taken { replaced: Option<Submitted> },
    /// Its buffer is being imported, and it goes up when that finishes.
    Importing { replaced: Option<Submitted> },
    /// The engine refused its buffer. The frame is handed back.
    Refused(Frame),
}

/// What [`EngineSession::dispatch`] found.
#[derive(Debug)]
pub struct Dispatched {
    /// The events for the caller to act on.
    pub events: Vec<Event>,
    /// The buffers to give back.
    pub releases: Vec<Release>,
    /// Apps whose frame went up once its buffer was imported.
    pub shown: Vec<String>,
}

#[derive(Debug)]
pub struct Release {
    pub buffer: Submitted,
    /// The window it belonged to, so the caller can log whose buffer it was.
    pub surface: SurfaceId,
    pub why: Returned,
}

/// Looks up a submitted buffer's dmabuf again.
///
/// The caller provides it because this module has no Smithay buffer types.
/// `None` means the window cannot be shown on the new engine.
pub type Describe<'a> = dyn Fn(&Submitted) -> Option<DmabufDescriptor> + 'a;

/// The result of [`EngineSession::reconnect`].
#[derive(Debug)]
pub struct Reconnected {
    /// Buffers to release, since the engine holding them is gone.
    pub releases: Vec<Release>,
    /// Whether the new engine was joined. On `Err` the session stays inert so
    /// a later reconnect can try again.
    pub dialed: Result<(), EngineError>,
    /// Apps whose last frame was resubmitted to the new engine.
    pub shown: Vec<String>,
    /// Apps whose window stays blank until the client draws again. The caller
    /// logs each one.
    pub blank: Vec<String>,
}

/// A live connection to the forked engine.
#[derive(Debug)]
pub struct EngineSession {
    engine: Engine,
    /// The engine's socket. A restarted engine listens on the same path.
    socket: std::path::PathBuf,
    /// One surface per app, brokered on the app's first commit, and which of
    /// them a page has embedded.
    surfaces: Surfaces,
    /// The engine id of each imported buffer, and the frames waiting for an
    /// import. Clients commit the same buffer repeatedly, so importing per
    /// commit would send new fds every frame.
    imports: Imports<ImportKey, Frame>,
    held: HeldBuffers<Submitted>,
    /// Each app's last crop and transform, reused when a reconnect
    /// resubmits its frame.
    sampled: HashMap<String, Sampled>,
    /// The frame each surface committed before a page embedded it. See
    /// `engine_waiting`.
    waiting: Waiting<Frame>,
}

impl EngineSession {
    /// Loads the engine and joins the browser.
    ///
    /// The error names the library. The caller stops on error instead of
    /// running with a blank screen.
    pub fn load(socket: &Path) -> Result<Self, EngineError> {
        Ok(Self {
            engine: Engine::load(LIBRARY, socket)?,
            socket: socket.to_path_buf(),
            surfaces: Surfaces::default(),
            imports: Imports::default(),
            held: HeldBuffers::default(),
            sampled: HashMap::new(),
            waiting: Waiting::default(),
        })
    }

    /// Joins a restarted engine and restores the old engine's state on it.
    ///
    /// - The new browser restarts its `SurfaceId` and `BufferId` counters, so
    ///   every recorded surface and import is stale and is dropped.
    /// - Every hold is returned, even if the dial fails, since the old engine
    ///   will never release it and the client cannot draw until it is.
    /// - Each surface's on-screen frame is imported and submitted again.
    ///   Otherwise an idle client's window stays blank, since nothing else
    ///   makes it commit.
    /// - Frame callbacks waiting on the old engine are the caller's to answer
    ///   (`crate::frame_callbacks`). The new surfaces number their frames
    ///   afresh.
    ///
    /// No check in this repository covers this. See
    /// `docs/HARDWARE-CHECKS.md#dead-engine-with-windows-open`.
    pub fn reconnect(&mut self, describe: &Describe, now: Instant) -> Reconnected {
        let taken = self.held.take_all();
        let apps: HashMap<SurfaceId, String> = self
            .surfaces
            .drain()
            .map(|(app_id, surface)| (surface, app_id))
            .collect();
        let importing = self.imports.clear();

        let dialed = self.engine.reconnect(&self.socket);
        if dialed.is_ok() {
            // Re-broker every app, including those with no frame to resubmit.
            // The browser holds the page's `embedExternalSurface()` until a
            // sink is brokered, and an idle client never commits to trigger
            // it. `surface_for` logs refusals; their frames end up in `blank`.
            for app_id in apps.values() {
                let _ = self.surface_for(app_id);
            }
        }

        let mut releases = returned(taken.superseded, Returned::Abandoned);
        // Waiting frames name old surfaces, so release them. The client draws
        // again once the new surface is embedded and configured.
        releases.extend(self.waiting.take_all().into_iter().chain(importing).map(
            |(surface, frame)| Release {
                buffer: frame.buffer,
                surface,
                why: Returned::Abandoned,
            },
        ));
        let mut session = Reconnected {
            releases,
            dialed,
            shown: Vec::new(),
            blank: Vec::new(),
        };
        for ((surface, _), buffer) in taken.on_screen {
            let Some(app_id) = apps.get(&surface) else {
                // Unreachable: `window_gone` drops an app's holds when it
                // forgets the app. Release the buffer anyway.
                session.releases.push(Release {
                    buffer,
                    surface,
                    why: Returned::Abandoned,
                });
                continue;
            };
            match self.show_again(app_id, &buffer, describe, now) {
                // Each replaced nothing, since it is the surface's only frame.
                Submission::Taken { .. } => session.shown.push(app_id.clone()),
                // Held until the page embeds the surface again.
                Submission::Waiting { .. } => session.blank.push(app_id.clone()),
                Submission::Refused => {
                    session.blank.push(app_id.clone());
                    session.releases.push(Release {
                        buffer,
                        surface,
                        why: Returned::Abandoned,
                    });
                }
            }
        }
        session
    }

    /// Resubmits one app's last frame to the new engine and keeps it held.
    ///
    /// [`Submission::Refused`] means the window stays blank until its client
    /// draws, and the caller logs it.
    fn show_again(
        &mut self,
        app_id: &str,
        buffer: &Submitted,
        describe: &Describe,
        now: Instant,
    ) -> Submission {
        let Some(descriptor) = describe(buffer) else {
            return Submission::Refused;
        };
        let sampled = self.sampled.get(app_id).copied().unwrap_or_default();
        // A new engine numbers its boxes afresh.
        self.submit(
            app_id,
            buffer.clone(),
            &descriptor,
            sampled,
            (0, 0, 0, 0),
            NEWEST_BOX,
            now,
        )
    }

    /// The fd to add to the compositor's loop.
    pub fn fd(&self) -> std::os::fd::RawFd {
        self.engine.fd()
    }

    /// Tells the engine which connectors to light and where.
    ///
    /// See [`crate::engine::Engine::configure_displays`], including what an
    /// empty list means.
    pub fn configure_displays(&self, connectors: &[Connector]) {
        self.engine.configure_displays(connectors);
    }

    /// Tells the browser what is on one of the desktop's two clipboards.
    ///
    /// See [`crate::engine::Engine::set_clipboard`], including why the browser
    /// is told rather than asked.
    pub fn set_clipboard(&self, clipboard: Clipboard, contents: &Contents) {
        self.engine.set_clipboard(clipboard, contents);
    }

    /// Submits a buffer as `app_id`'s window, at the box `at_box` names (see
    /// [`crate::engine::Engine::submit`]). See [`Submission`] for who owns the
    /// buffer afterward.
    #[allow(clippy::too_many_arguments)] // One frame's worth.
    pub fn submit(
        &mut self,
        app_id: &str,
        buffer: Submitted,
        descriptor: &DmabufDescriptor,
        sampled: Sampled,
        damage: (i32, i32, i32, i32),
        at_box: u64,
        now: Instant,
    ) -> Submission {
        let Some(surface) = self.surface_for(app_id) else {
            return Submission::Refused;
        };
        let frame = Frame {
            buffer,
            descriptor: descriptor.clone(),
            sampled,
            at_box,
        };
        // The engine drops frames for unembedded surfaces and never releases
        // them (see `engine_surfaces`), so the frame waits for the embed. See
        // `engine_waiting`.
        if !self.surfaces.takes_frames(surface) {
            return Submission::Waiting {
                replaced: self
                    .waiting
                    .wait(surface, frame)
                    .map(|replaced| replaced.buffer),
            };
        }
        match self.put_up(app_id, surface, frame, damage, now) {
            PutUp::Taken { replaced } => Submission::Taken { replaced },
            PutUp::Importing { replaced } => Submission::Waiting { replaced },
            PutUp::Refused(_) => Submission::Refused,
        }
    }

    /// Submits the frame waiting for `surface` after a page embeds it.
    ///
    /// Returns `Ok(false)` if nothing was waiting or the frame now waits for
    /// its import, and `Err` with the buffer to release if the engine refused
    /// it.
    pub fn show_what_was_waiting(
        &mut self,
        surface: SurfaceId,
        now: Instant,
    ) -> Result<bool, Release> {
        let Some(frame) = self.waiting.take(surface) else {
            return Ok(false);
        };
        let refused = |buffer| Release {
            buffer,
            surface,
            why: Returned::Abandoned,
        };
        let Some(app_id) = self.surfaces.app_for(surface).map(str::to_owned) else {
            return Err(refused(frame.buffer));
        };
        // A frame waits for an import only on an embedded surface, and this
        // one was not embedded until now, so none is replaced.
        match self.put_up(&app_id, surface, frame, (0, 0, 0, 0), now) {
            PutUp::Taken { replaced: None } => Ok(true),
            PutUp::Importing { replaced: None } => Ok(false),
            PutUp::Taken { replaced: Some(_) } | PutUp::Importing { replaced: Some(_) } => {
                unreachable!("a surface embedded just now had a frame waiting for an import")
            }
            PutUp::Refused(frame) => Err(refused(frame.buffer)),
        }
    }

    /// Submits and holds a frame for an embedded surface, or starts importing
    /// its buffer and holds it back until the import finishes.
    ///
    /// An engine without `domicile_surface_import_async` imports while the
    /// caller waits.
    fn put_up(
        &mut self,
        app_id: &str,
        surface: SurfaceId,
        frame: Frame,
        damage: (i32, i32, i32, i32),
        now: Instant,
    ) -> PutUp {
        let key = frame.buffer.key();
        let dmabuf = match self.imports.knows(&key) {
            true => None,
            false => match Dmabuf::from_descriptor(&frame.descriptor) {
                Some(dmabuf) => Some(dmabuf),
                None => {
                    tracing::error!(
                        planes = frame.descriptor.planes.len(),
                        "a dmabuf with this many planes cannot cross the engine ABI"
                    );
                    return PutUp::Refused(frame);
                }
            },
        };
        if let Some(dmabuf) = &dmabuf {
            if !self.engine.imports_in_the_background() {
                match self.engine.import(surface, dmabuf) {
                    Some(id) => self.imports.imported(key.clone(), surface, id),
                    None => {
                        say_it_was_refused(&frame.descriptor);
                        return PutUp::Refused(frame);
                    }
                }
            }
        }
        match self.imports.route(surface, key, frame) {
            Route::Submit {
                id,
                frame,
                replaced,
            } => {
                self.show(app_id, surface, id, frame, damage, now);
                PutUp::Taken {
                    replaced: replaced.map(|frame| frame.buffer),
                }
            }
            Route::Wait { replaced, start } => {
                if let Some(request) = start {
                    let dmabuf = dmabuf
                        .as_ref()
                        .expect("an import starts only for a buffer not yet imported");
                    self.engine
                        .import_in_the_background(surface, dmabuf, request);
                }
                PutUp::Importing {
                    replaced: replaced.map(|frame| frame.buffer),
                }
            }
        }
    }

    /// Submits and holds a frame whose buffer is imported as `id`.
    fn show(
        &mut self,
        app_id: &str,
        surface: SurfaceId,
        id: BufferId,
        frame: Frame,
        damage: (i32, i32, i32, i32),
        now: Instant,
    ) {
        self.engine
            .submit(surface, id, frame.sampled, damage, frame.at_box);
        self.surfaces.submitted(surface);
        self.sampled.insert(app_id.to_owned(), frame.sampled);
        // A replaced hold is the same buffer, since `imports` is keyed on the
        // object. Drop it without releasing: viz holds it again.
        drop(self.held.hold(surface, id, frame.buffer, now));
    }

    /// Runs the engine's pending work, and puts up the frames whose imports
    /// finished.
    pub fn dispatch(&mut self, now: Instant) -> Dispatched {
        let events = self.engine.dispatch();
        let mut dispatched = Dispatched {
            events: Vec::new(),
            releases: Vec::new(),
            shown: Vec::new(),
        };
        for event in &events {
            match event {
                Event::Released { surface, buffer } => {
                    if let Some(buffer) = self.held.release(*surface, *buffer) {
                        dispatched.releases.push(Release {
                            buffer,
                            surface: *surface,
                            why: Returned::Released,
                        });
                    }
                }
                // A page embedded this surface, so `submit` may now hold
                // buffers for it. See `engine_surfaces`.
                Event::Configure { surface, .. } => self.surfaces.embedded(*surface),
                Event::Imported {
                    request, buffer, ..
                } => self.import_finished(*request, *buffer, now, &mut dispatched),
                Event::Copied { .. }
                | Event::Displays(_)
                | Event::Captured { .. }
                | Event::CaptureEnded { .. }
                | Event::FrameDone { .. }
                | Event::Presented { .. } => {}
            }
        }
        dispatched.events = events;
        dispatched
    }

    /// Puts up or hands back the frames that waited on `request`.
    fn import_finished(
        &mut self,
        request: Request,
        buffer: Option<BufferId>,
        now: Instant,
        dispatched: &mut Dispatched,
    ) {
        let finished = self.imports.finished(request, buffer);
        if let Some((surface, id)) = finished.forget {
            self.engine.forget(surface, id);
        }
        for then in finished.then {
            match then {
                Then::Submit { surface, id, frame } => {
                    let app_id = self
                        .surfaces
                        .app_for(surface)
                        .expect("`window_gone` takes the frames of the surfaces it forgets")
                        .to_owned();
                    self.show(&app_id, surface, id, frame, (0, 0, 0, 0), now);
                    dispatched.shown.push(app_id);
                }
                Then::Refused { surface, frame } => {
                    say_it_was_refused(&frame.descriptor);
                    dispatched.releases.push(Release {
                        buffer: frame.buffer,
                        surface,
                        why: Returned::Abandoned,
                    });
                }
            }
        }
    }
    /// Buffers viz kept past the deadline, taken back so the client can draw.
    /// Each one is an engine bug, and the caller logs it.
    pub fn overdue(&mut self, now: Instant) -> Vec<Release> {
        returned(self.held.expired(now), Returned::Expired)
    }

    /// When [`EngineSession::overdue`] next has a buffer to take back.
    pub fn next_overdue(&self) -> Option<Instant> {
        self.held.next_expiry()
    }

    /// Destroys the app's surface and returns its buffers at once, since no
    /// release will arrive for them.
    pub fn window_gone(&mut self, app_id: &str) -> Vec<Release> {
        self.sampled.remove(app_id);
        let Some(surface) = self.surfaces.forget(app_id) else {
            return Vec::new();
        };
        // The GPU process keeps each imported buffer's fds until told to
        // forget it. Leaked imports exhaust its fds and crash it on a `CHECK`.
        let gone = self.imports.surface_gone(surface);
        for buffer in gone.ids {
            self.engine.forget(surface, buffer);
        }
        self.engine.destroy_surface(surface);
        let waited = self.waiting.take(surface).into_iter().chain(gone.waited);
        returned(self.held.abandon(surface), Returned::Abandoned)
            .into_iter()
            .chain(waited.map(|frame| Release {
                buffer: frame.buffer,
                surface,
                why: Returned::Abandoned,
            }))
            .collect()
    }

    /// Drops the import for a destroyed `wl_buffer` and returns its hold, if
    /// any, since no release will arrive for it.
    pub fn buffer_destroyed(&mut self, buffer: &wl_buffer::WlBuffer) -> Option<Release> {
        // A frame waiting for an embed was never imported, so there is nothing
        // else to drop.
        let key = ImportKey::Client(buffer.id());
        if let Some((surface, frame)) = self.waiting.take_where(|frame| frame.buffer.key() == key) {
            return Some(Release {
                buffer: frame.buffer,
                surface,
                why: Returned::Abandoned,
            });
        }
        let forgotten = self.imports.forget(&key);
        let held = forgotten.id.and_then(|(surface, id)| {
            self.engine.forget(surface, id);
            self.held.release(surface, id).map(|buffer| Release {
                buffer,
                surface,
                why: Returned::Abandoned,
            })
        });
        held.or_else(|| {
            forgotten
                .waited
                .into_iter()
                .next()
                .map(|(surface, frame)| Release {
                    buffer: frame.buffer,
                    surface,
                    why: Returned::Abandoned,
                })
        })
    }

    /// Drops the import for a freed compositor buffer so the browser closes its
    /// fds. [`crate::uploads`] frees only buffers the engine is not holding or
    /// waiting to show.
    pub fn upload_dropped(&mut self, upload: UploadId) {
        let forgotten = self.imports.forget(&ImportKey::Upload(upload));
        assert!(
            forgotten.waited.is_empty(),
            "a freed upload had a frame waiting for its import"
        );
        if let Some((surface, id)) = forgotten.id {
            self.engine.forget(surface, id);
        }
    }

    /// Spike helper. See [`crate::engine::Engine::spike_window_center`].
    pub fn spike_window_center(&self) -> Option<u32> {
        self.engine.spike_window_center()
    }

    /// Spike helper. See [`crate::engine::Engine::spike_pixel`].
    pub fn spike_pixel(&self, x: i32, y: i32) -> Option<u32> {
        self.engine.spike_pixel(x, y)
    }

    /// Spike helper. See [`crate::engine::Engine::spike_find`].
    pub fn spike_find(&self, argb: u32) -> Option<Capture> {
        self.engine.spike_find(argb)
    }

    /// The number of `app_id`'s last submitted frame, which
    /// [`Event::FrameDone`] and [`Event::Presented`] name.
    pub fn frame_of(&self, app_id: &str) -> Option<u64> {
        self.surfaces.last_frame(app_id)
    }

    /// See [`crate::engine::Engine::reports_frames`].
    pub fn reports_frames(&self) -> bool {
        self.engine.reports_frames()
    }

    /// Which app a surface belongs to, for an event that names only the
    /// surface.
    pub fn app_for(&self, surface: SurfaceId) -> Option<&str> {
        self.surfaces.app_for(surface)
    }

    /// The surface for `app_id`, brokered on first use. `None` if the browser
    /// refused, which is logged.
    fn surface_for(&mut self, app_id: &str) -> Option<SurfaceId> {
        if let Some(surface) = self.surfaces.get(app_id) {
            return Some(surface);
        }
        match self.engine.create_surface(app_id) {
            Ok(surface) => {
                tracing::debug!(%app_id, surface, "the browser brokered a frame sink");
                self.surfaces.brokered(app_id, surface);
                Some(surface)
            }
            Err(err) => {
                tracing::error!(%app_id, %err, "no frame sink for this app; it will not be shown");
                None
            }
        }
    }
}

/// Logs a dmabuf the browser would not import.
fn say_it_was_refused(descriptor: &DmabufDescriptor) {
    tracing::error!(
        fourcc = descriptor.fourcc,
        modifier = descriptor.modifier,
        "the browser refused this dmabuf"
    );
}

/// Converts removed holds into releases.
fn returned(holds: Vec<((SurfaceId, BufferId), Submitted)>, why: Returned) -> Vec<Release> {
    holds
        .into_iter()
        .map(|((surface, _), buffer)| Release {
            buffer,
            surface,
            why,
        })
        .collect()
}

/// The engine's display captures, for monitor and region casts. Thin glue
/// over [`crate::engine::Engine`]; the bookkeeping is in
/// [`crate::casting::Capturer`]'s callers.
impl crate::casting::Capturer for EngineSession {
    fn start(
        &mut self,
        display: i64,
        size: (u32, u32),
        max_fps: u32,
    ) -> Result<crate::engine::CaptureId, String> {
        self.engine
            .start_capture(display, size, max_fps)
            .map_err(|why| why.to_string())
    }

    fn resize(&mut self, capture: crate::engine::CaptureId, size: (u32, u32)) {
        self.engine.resize_capture(capture, size);
    }

    fn stop(&mut self, capture: crate::engine::CaptureId) {
        self.engine.stop_capture(capture);
    }

    fn release(&mut self, capture: crate::engine::CaptureId, frame: u64) {
        self.engine.release_captured(capture, frame);
    }
}
