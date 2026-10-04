//! The compositor's connection to the engine: the loaded library, the surfaces
//! brokered through it, and the client buffers it holds.
//!
//! [`crate::engine`] is the ABI; this module uses it.

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use crate::dmabuf_descriptor::DmabufDescriptor;
use smithay::reexports::wayland_server::backend::ObjectId;
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::reexports::wayland_server::Resource as _;

use crate::engine::{
    BufferId, Capture, Clipboard, Connector, Dmabuf, Engine, EngineError, Event, SurfaceId, LIBRARY,
};
use crate::engine_buffers::{HeldBuffers, Returned};
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
    /// Viz has it. The caller must not release the buffer.
    Taken,
    /// No page has embedded the surface yet, so the frame waits for the embed
    /// (see `engine_waiting`). The caller must not release the buffer, and
    /// must release `replaced`.
    Waiting { replaced: Option<Submitted> },
    /// Nothing was submitted; the buffer is still the caller's.
    Refused,
}

/// A frame waiting to be submitted.
#[derive(Debug)]
struct Frame {
    buffer: Submitted,
    descriptor: DmabufDescriptor,
    crop: (i32, i32, i32, i32),
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
    /// The engine id of each imported buffer. Clients commit the same buffer
    /// repeatedly, so importing per commit would send new fds every frame.
    imports: HashMap<ImportKey, (SurfaceId, BufferId)>,
    held: HeldBuffers<Submitted>,
    /// Each app's last crop, reused when a reconnect resubmits its frame.
    crops: HashMap<String, (i32, i32, i32, i32)>,
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
            imports: HashMap::new(),
            held: HeldBuffers::default(),
            crops: HashMap::new(),
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
    /// - Frame callbacks need no handling: `wl_surface.frame` is answered at
    ///   commit, not from the engine's `Frame` event.
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
        self.imports.clear();

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
        releases.extend(
            self.waiting
                .take_all()
                .into_iter()
                .map(|(surface, frame)| Release {
                    buffer: frame.buffer,
                    surface,
                    why: Returned::Abandoned,
                }),
        );
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
                Submission::Taken => session.shown.push(app_id.clone()),
                // Held until the page embeds the surface again. It replaced
                // nothing, since it is the surface's only frame.
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
        let crop = self.crops.get(app_id).copied().unwrap_or_default();
        self.submit(app_id, buffer.clone(), &descriptor, crop, (0, 0, 0, 0), now)
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
    pub fn set_clipboard(&self, clipboard: Clipboard, text: &str) {
        self.engine.set_clipboard(clipboard, text);
    }

    /// Submits a buffer as `app_id`'s window. See [`Submission`] for who owns
    /// the buffer afterward.
    pub fn submit(
        &mut self,
        app_id: &str,
        buffer: Submitted,
        descriptor: &DmabufDescriptor,
        crop: (i32, i32, i32, i32),
        damage: (i32, i32, i32, i32),
        now: Instant,
    ) -> Submission {
        let Some(surface) = self.surface_for(app_id) else {
            return Submission::Refused;
        };
        // The engine drops frames for unembedded surfaces and never releases
        // them (see `engine_surfaces`), so the frame waits for the embed. See
        // `engine_waiting`.
        if !self.surfaces.takes_frames(surface) {
            let frame = Frame {
                buffer,
                descriptor: descriptor.clone(),
                crop,
            };
            return Submission::Waiting {
                replaced: self
                    .waiting
                    .wait(surface, frame)
                    .map(|replaced| replaced.buffer),
            };
        }
        match self.put_up(app_id, surface, buffer, descriptor, crop, damage, now) {
            true => Submission::Taken,
            false => Submission::Refused,
        }
    }

    /// Submits the frame waiting for `surface` after a page embeds it.
    ///
    /// Returns `Ok(false)` if nothing was waiting, and `Err` with the buffer
    /// to release if the engine refused it.
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
        let buffer = frame.buffer.clone();
        match self.put_up(
            &app_id,
            surface,
            frame.buffer,
            &frame.descriptor,
            frame.crop,
            (0, 0, 0, 0),
            now,
        ) {
            true => Ok(true),
            false => Err(refused(buffer)),
        }
    }

    /// Imports, submits and holds a frame for an embedded surface. Returns
    /// `false` if the engine refused the import.
    #[allow(clippy::too_many_arguments)] // One frame's worth, as `submit` takes it.
    fn put_up(
        &mut self,
        app_id: &str,
        surface: SurfaceId,
        buffer: Submitted,
        descriptor: &DmabufDescriptor,
        crop: (i32, i32, i32, i32),
        damage: (i32, i32, i32, i32),
        now: Instant,
    ) -> bool {
        let Some(id) = self.import(surface, &buffer, descriptor) else {
            return false;
        };
        self.engine.submit(surface, id, crop, damage);
        self.crops.insert(app_id.to_owned(), crop);
        // A replaced hold is the same buffer, since `imports` is keyed on the
        // object. Drop it without releasing: viz holds it again.
        drop(self.held.hold(surface, id, buffer, now));
        true
    }

    /// Runs the engine's pending work.
    ///
    /// Returns the events for the caller to act on and the buffers viz
    /// released.
    pub fn dispatch(&mut self) -> (Vec<Event>, Vec<Release>) {
        let events = self.engine.dispatch();
        let releases = events
            .iter()
            .filter_map(|event| match event {
                Event::Released { surface, buffer } => {
                    self.held.release(*surface, *buffer).map(|buffer| Release {
                        buffer,
                        surface: *surface,
                        why: Returned::Released,
                    })
                }
                // A page embedded this surface, so `submit` may now hold
                // buffers for it. See `engine_surfaces`.
                Event::Configure { surface, .. } => {
                    self.surfaces.embedded(*surface);
                    None
                }
                Event::Copied { .. } | Event::Frame { .. } | Event::Displays(_) => None,
            })
            .collect();
        (events, releases)
    }

    /// Buffers viz kept past the deadline, taken back so the client can draw.
    /// Each one is an engine bug, and the caller logs it.
    pub fn overdue(&mut self, now: Instant) -> Vec<Release> {
        returned(self.held.expired(now), Returned::Expired)
    }

    /// Destroys the app's surface and returns its buffers at once, since no
    /// release will arrive for them.
    pub fn window_gone(&mut self, app_id: &str) -> Vec<Release> {
        self.crops.remove(app_id);
        let Some(surface) = self.surfaces.forget(app_id) else {
            return Vec::new();
        };
        // The GPU process keeps each imported buffer's fds until told to
        // forget it. Leaked imports exhaust its fds and crash it on a `CHECK`.
        for buffer in take_imports_of(&mut self.imports, surface) {
            self.engine.forget(surface, buffer);
        }
        self.engine.destroy_surface(surface);
        let waited = self.waiting.take(surface).map(|frame| Release {
            buffer: frame.buffer,
            surface,
            why: Returned::Abandoned,
        });
        returned(self.held.abandon(surface), Returned::Abandoned)
            .into_iter()
            .chain(waited)
            .collect()
    }

    /// Drops the import for a destroyed `wl_buffer` and returns its hold, if
    /// any, since no release will arrive for it.
    pub fn buffer_destroyed(&mut self, buffer: &wl_buffer::WlBuffer) -> Option<Release> {
        // A waiting frame was never imported, so there is nothing else to drop.
        let key = ImportKey::Client(buffer.id());
        if let Some((surface, frame)) = self.waiting.take_where(|frame| frame.buffer.key() == key) {
            return Some(Release {
                buffer: frame.buffer,
                surface,
                why: Returned::Abandoned,
            });
        }
        let (surface, id) = self.imports.remove(&key)?;
        self.engine.forget(surface, id);
        self.held.release(surface, id).map(|buffer| Release {
            buffer,
            surface,
            why: Returned::Abandoned,
        })
    }

    /// Drops the import for a freed compositor buffer so the browser closes its
    /// fds. [`crate::uploads`] frees only buffers viz is not holding.
    pub fn upload_dropped(&mut self, upload: UploadId) {
        if let Some((surface, id)) = self.imports.remove(&ImportKey::Upload(upload)) {
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

    /// The buffer's id, importing it the first time it is seen.
    fn import(
        &mut self,
        surface: SurfaceId,
        buffer: &Submitted,
        descriptor: &DmabufDescriptor,
    ) -> Option<BufferId> {
        if let Some((_, id)) = self.imports.get(&buffer.key()) {
            return Some(*id);
        }
        let dmabuf = Dmabuf::from_descriptor(descriptor).or_else(|| {
            tracing::error!(
                planes = descriptor.planes.len(),
                "a dmabuf with this many planes cannot cross the engine ABI"
            );
            None
        })?;
        let id = self.engine.import(surface, &dmabuf).or_else(|| {
            tracing::error!(
                fourcc = descriptor.fourcc,
                modifier = descriptor.modifier,
                "the browser refused this dmabuf"
            );
            None
        })?;
        self.imports.insert(buffer.key(), (surface, id));
        Some(id)
    }
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

/// Removes `surface`'s imports and returns the ids the engine must forget.
fn take_imports_of<K>(
    imports: &mut HashMap<K, (SurfaceId, BufferId)>,
    surface: SurfaceId,
) -> Vec<BufferId> {
    imports
        .extract_if(|_, (held, _)| *held == surface)
        .map(|(_, (_, id))| id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_surface_s_imports_are_taken_out_and_no_other_s() {
        let mut imports = HashMap::from([(1, (7, 10)), (2, (7, 11)), (3, (8, 12))]);

        let mut taken = take_imports_of(&mut imports, 7);

        taken.sort();
        assert_eq!(taken, vec![10, 11]);
        assert_eq!(imports, HashMap::from([(3, (8, 12))]));
    }
}
