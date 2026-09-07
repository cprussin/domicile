//! The compositor's side of the engine seam: one loaded library, the surfaces
//! brokered through it, and the client buffers it is holding.
//!
//! [`crate::engine`] is the ABI; this is what the compositor does with it.

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use domicile_bridge::DmabufDescriptor;
use smithay::reexports::wayland_server::backend::ObjectId;
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::reexports::wayland_server::Resource as _;

use crate::engine::{BufferId, Capture, Dmabuf, Engine, EngineError, Event, SurfaceId, LIBRARY};
use crate::engine_buffers::{HeldBuffers, Returned};

/// A buffer going back to the client, and why. Every one of these is a
/// `wl_buffer.release` the caller owes.
#[derive(Debug)]
pub struct Release {
    pub buffer: wl_buffer::WlBuffer,
    /// Which window's it was. Carried rather than looked up by the caller
    /// because by the time an expiry is reported the only thing that knows is
    /// the hold it came out of — and "a buffer was never released" says
    /// nothing useful without saying whose.
    pub surface: SurfaceId,
    pub why: Returned,
}

/// A live connection to the forked engine.
#[derive(Debug)]
pub struct EngineSession {
    engine: Engine,
    /// One surface per app, brokered the first time that app commits.
    surfaces: HashMap<String, SurfaceId>,
    /// Which imported buffer each `wl_buffer` is. A client commits the same
    /// buffer over and over; importing per commit would hand the browser
    /// another set of fds every frame for the same pixmap.
    imports: HashMap<ObjectId, (SurfaceId, BufferId)>,
    held: HeldBuffers<wl_buffer::WlBuffer>,
}

impl EngineSession {
    /// Loads the engine and joins the browser.
    ///
    /// Failure names the library. A compositor that asked for the engine and
    /// cannot have it says so and stops; it does not come up showing nothing.
    pub fn load(socket: &Path) -> Result<Self, EngineError> {
        Ok(Self {
            engine: Engine::load(LIBRARY, socket)?,
            surfaces: HashMap::new(),
            imports: HashMap::new(),
            held: HeldBuffers::default(),
        })
    }

    /// The fd to add to the compositor's loop.
    pub fn fd(&self) -> std::os::fd::RawFd {
        self.engine.fd()
    }

    /// Submits a client's buffer as `app_id`'s window.
    ///
    /// `true` means the engine has the buffer and **the caller must not release
    /// it**. `false` means nothing was submitted and the buffer is the caller's
    /// exactly as before — which is what every path that is not a submitted app
    /// frame relies on.
    pub fn submit(
        &mut self,
        app_id: &str,
        buffer: &wl_buffer::WlBuffer,
        descriptor: &DmabufDescriptor,
        damage: (i32, i32, i32, i32),
        now: Instant,
    ) -> bool {
        let Some(surface) = self.surface_for(app_id) else {
            return false;
        };
        let Some(id) = self.import(surface, buffer, descriptor) else {
            return false;
        };
        self.engine.submit(surface, id, damage);
        // A hold this replaced is the *same* `wl_buffer` — ids come from
        // `imports`, which is keyed on the object — so it is dropped and not
        // released. Releasing it would tell the client it may draw into the
        // buffer viz has only just been handed, which is the tear this whole
        // path exists to avoid. The one release the client is owed arrives when
        // viz is done with the submission it actually has.
        drop(self.held.hold(surface, id, buffer.clone(), now));
        true
    }

    /// Runs the engine's pending work.
    ///
    /// The buffers are this module's to hand back; the events are the caller's
    /// to act on, because a configure is an `xdg_toplevel.configure` and a
    /// frame is a `wl_surface.frame` and neither is bookkeeping.
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
                Event::Configure { .. } | Event::Frame { .. } => None,
            })
            .collect();
        (events, releases)
    }

    /// Buffers viz has sat on past the deadline, taken back so the client can
    /// draw. Every one is a bug on the other side of the seam and the caller is
    /// expected to say so.
    pub fn overdue(&mut self, now: Instant) -> Vec<Release> {
        self.held
            .expired(now)
            .into_iter()
            .map(|((surface, _), buffer)| Release {
                buffer,
                surface,
                why: Returned::Expired,
            })
            .collect()
    }

    /// The app's window went away. Everything the engine was holding for it
    /// comes back at once: no release will ever arrive for a surface that is
    /// gone, and waiting out the deadline for each would stall a client that
    /// is still running for no reason.
    pub fn window_gone(&mut self, app_id: &str) -> Vec<Release> {
        let Some(surface) = self.surfaces.remove(app_id) else {
            return Vec::new();
        };
        self.imports.retain(|_, (held, _)| *held != surface);
        self.held
            .abandon(surface)
            .into_iter()
            .map(|((surface, _), buffer)| Release {
                buffer,
                surface,
                why: Returned::Abandoned,
            })
            .collect()
    }

    /// The client destroyed a `wl_buffer`. Drops the import so its fds go, and
    /// hands back the hold if the engine still had it — no release will arrive
    /// for a buffer whose object is gone.
    pub fn buffer_destroyed(&mut self, buffer: &wl_buffer::WlBuffer) -> Option<Release> {
        let (surface, id) = self.imports.remove(&buffer.id())?;
        self.engine.forget(surface, id);
        self.held.release(surface, id).map(|buffer| Release {
            buffer,
            surface,
            why: Returned::Abandoned,
        })
    }

    /// THROWAWAY. See [`crate::engine::Engine::spike_window_centre`].
    pub fn spike_window_centre(&self) -> Option<u32> {
        self.engine.spike_window_centre()
    }

    /// THROWAWAY. See [`crate::engine::Engine::spike_pixel`].
    pub fn spike_pixel(&self, x: i32, y: i32) -> Option<u32> {
        self.engine.spike_pixel(x, y)
    }

    /// THROWAWAY. See [`crate::engine::Engine::spike_find`].
    pub fn spike_find(&self, argb: u32) -> Option<Capture> {
        self.engine.spike_find(argb)
    }

    /// Which app a surface belongs to, for an event that names only the
    /// surface. One engine holds a handful of windows, so a scan beats keeping
    /// a second map honest.
    pub fn app_for(&self, surface: SurfaceId) -> Option<&str> {
        self.surfaces
            .iter()
            .find(|(_, held)| **held == surface)
            .map(|(app_id, _)| app_id.as_str())
    }

    /// The one surface for `app_id`, brokered on first use. `None` if the
    /// browser refused, which is logged once rather than every frame.
    fn surface_for(&mut self, app_id: &str) -> Option<SurfaceId> {
        if let Some(surface) = self.surfaces.get(app_id) {
            return Some(*surface);
        }
        match self.engine.create_surface(app_id) {
            Ok(surface) => {
                tracing::info!(%app_id, surface, "the browser brokered a frame sink");
                self.surfaces.insert(app_id.to_owned(), surface);
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
        buffer: &wl_buffer::WlBuffer,
        descriptor: &DmabufDescriptor,
    ) -> Option<BufferId> {
        if let Some((_, id)) = self.imports.get(&buffer.id()) {
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
        self.imports.insert(buffer.id(), (surface, id));
        Some(id)
    }
}
