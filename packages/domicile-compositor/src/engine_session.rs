//! The compositor's side of the engine seam: one loaded library, the surfaces
//! brokered through it, and the client buffers it is holding.
//!
//! [`crate::engine`] is the ABI; this is what the compositor does with it.

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

/// A buffer the engine was handed: a client's own dmabuf, or one of the
/// compositor's that an shm client's frame was copied into.
///
/// Both are held until viz releases them, for the same reason. What differs is
/// who is owed the release — a `wl_buffer.release` for the first, a buffer
/// going back to [`crate::uploads::Uploads`] for the second.
#[derive(Debug, Clone, PartialEq)]
pub enum Submitted {
    Client(wl_buffer::WlBuffer),
    Upload(UploadId),
}

/// What an import is recorded against: the object for a client's buffer, the
/// id for one of the compositor's.
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

/// A buffer coming back from the engine, and why. Every one of these is a
/// `wl_buffer.release` the caller owes, or a buffer of its own that is free.
/// What became of a frame handed to [`EngineSession::submit`].
#[derive(Debug, PartialEq)]
pub enum Submission {
    /// Viz has it. The caller must not release the buffer.
    Taken,
    /// No page has embedded the surface yet, so it waits to go up when one
    /// does — see `engine_waiting`. The caller must not release the buffer;
    /// the frame it replaced, if any, is the caller's to give back.
    Waiting { replaced: Option<Submitted> },
    /// Nothing was submitted; the buffer is the caller's exactly as before.
    Refused,
}

/// A frame as it will be submitted, once there is somewhere to submit it.
#[derive(Debug)]
struct Frame {
    buffer: Submitted,
    descriptor: DmabufDescriptor,
    crop: (i32, i32, i32, i32),
}

#[derive(Debug)]
pub struct Release {
    pub buffer: Submitted,
    /// Which window's it was. Carried rather than looked up by the caller
    /// because by the time an expiry is reported the only thing that knows is
    /// the hold it came out of — and "a buffer was never released" says
    /// nothing useful without saying whose.
    pub surface: SurfaceId,
    pub why: Returned,
}

/// A submitted buffer's dmabuf, asked for again.
///
/// The caller's, because turning a `wl_buffer` back into one is Smithay's job
/// and this module carries no Smithay buffer types — and because the
/// compositor's own buffers are the caller's too. `None` here is a window that
/// cannot be shown to the new engine.
pub type Describe<'a> = dyn Fn(&Submitted) -> Option<DmabufDescriptor> + 'a;

/// What a reconnect gave back and what it could not put back.
#[derive(Debug)]
pub struct Reconnected {
    /// `wl_buffer.release`s the clients are owed, because the engine holding
    /// them is gone and nothing will ever release them.
    pub releases: Vec<Release>,
    /// Whether the engine that replaced the old one was joined at all. `Err`
    /// leaves the session in place and inert so the next page to reach this
    /// compositor can ask again.
    pub dialed: Result<(), EngineError>,
    /// The apps whose last frame went to the new engine, so their window is
    /// back on the page showing what it was showing.
    pub shown: Vec<String>,
    /// The apps whose window is on the page with nothing in it until the
    /// client draws again. Every one of these is worth a line: a window that
    /// is present and never draws is worse than one that went with the crash.
    pub blank: Vec<String>,
}

/// A live connection to the forked engine.
#[derive(Debug)]
pub struct EngineSession {
    engine: Engine,
    /// Where the engine is. Kept because it is where the NEXT engine will be
    /// too: the launcher takes the dead one's socket away and starts another
    /// under the same path.
    socket: std::path::PathBuf,
    /// One surface per app, brokered the first time that app commits, and
    /// which of them a page has embedded.
    surfaces: Surfaces,
    /// Which imported buffer each `wl_buffer` is. A client commits the same
    /// buffer over and over; importing per commit would hand the browser
    /// another set of fds every frame for the same pixmap.
    imports: HashMap<ImportKey, (SurfaceId, BufferId)>,
    held: HeldBuffers<Submitted>,
    /// The part of its buffer each app's last frame showed, so the frame a
    /// reconnect puts back up is cropped the way it was.
    crops: HashMap<String, (i32, i32, i32, i32)>,
    /// The frame each surface committed before a page embedded it — see
    /// `engine_waiting`.
    waiting: Waiting<Frame>,
}

impl EngineSession {
    /// Loads the engine and joins the browser.
    ///
    /// Failure names the library. A compositor that asked for the engine and
    /// cannot have it says so and stops; it does not come up showing nothing.
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

    /// Join the engine that replaced the one this session was joined to, and
    /// state to it everything the old one knew.
    ///
    /// **EVERYTHING THE OLD ENGINE KNEW IS STALE, all of it, at once.** A
    /// `SurfaceId` is minted by the browser's `FrameSinkBroker` and a
    /// `BufferId` by a `BrokeredFrameSink`, and both counters start over in
    /// the process that replaced them — so every surface this session has and
    /// every import it recorded names something in a mojo graph that no longer
    /// exists. Keeping any of it would be worse than losing it: the ids are
    /// plausible, a submit against them is accepted by nobody and reported by
    /// nothing, and the window would be on the page and permanently blank.
    ///
    /// **THE HOLDS ARE THE PART A CLIENT CAN HANG ON.** A `wl_buffer` viz was
    /// sampling is one the client may not draw into, and the release that
    /// would free it was going to come from an engine that is gone. So every
    /// hold comes back — WHETHER OR NOT the new engine was dialed, because a
    /// client waiting on a release that cannot arrive has stopped drawing
    /// forever and that is true either way.
    ///
    /// **THE FRAME EACH WINDOW HAD ON SCREEN GOES STRAIGHT BACK UP**, and that
    /// is what makes this windows surviving rather than windows reappearing.
    /// The newest hold for a surface is the frame the display was reading
    /// (`HeldBuffers::take_all`), the compositor still holds the client's
    /// `wl_buffer` for it, and the fds behind it are as good as they were — so
    /// it is imported and submitted to the new engine and kept held. Without
    /// that, a window whose client is idle — a terminal nobody is typing in —
    /// would sit there empty until somebody touched it, because nothing else
    /// makes a client commit.
    ///
    /// **FRAME CALLBACKS ARE NOT IN THIS**, and that is a fact about the
    /// compositor rather than an omission: `wl_surface.frame` is answered at
    /// commit and the engine's `Frame` event is dropped where it arrives, so
    /// there is no client waiting on a frame callback the old engine owed.
    /// The moment that changes, it belongs here beside the releases.
    ///
    /// A sink is re-brokered for every app that had one — eagerly, rather than
    /// on the next commit the way a first window is — for the reason the body
    /// gives where it does it.
    ///
    /// **NOTHING HERE IS EXERCISED BY ANY CHECK IN THIS REPOSITORY.** It needs
    /// a built `libdomicile_engine.so`, a browser to dial and a client with a
    /// dmabuf. See ROADMAP.md, *Needs a machine with a screen*.
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
            // EVERY APP THAT HAD A SURFACE, not just the ones with a frame to
            // put back. The browser holds the page's `embedExternalSurface()`
            // until a producer has been brokered a sink, so an app nobody
            // re-brokered is an `<app>` element waiting on a call that only a
            // commit would make — and a window whose client is idle and holds
            // no buffer at all makes none.
            //
            // The id is not read here: `surface_for` keeps it and says on the
            // log which app the browser refused, and there is nothing else to
            // do about one. A frame for a refused app goes to `blank` below.
            for app_id in apps.values() {
                let _ = self.surface_for(app_id);
            }
        }

        let mut releases = returned(taken.superseded, Returned::Abandoned);
        // A frame waiting for an embed on the old engine waits no longer: the
        // surface it names is gone, and the client draws again when the new
        // one is embedded and it is configured.
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
                // A hold whose surface no app claims. `window_gone` abandons
                // every hold in the same call it forgets the app, so this is
                // unreachable rather than tolerated — and the buffer still
                // goes back to whoever owns it.
                session.releases.push(Release {
                    buffer,
                    surface,
                    why: Returned::Abandoned,
                });
                continue;
            };
            match self.show_again(app_id, &buffer, describe, now) {
                Submission::Taken => session.shown.push(app_id.clone()),
                // Not shown, but held: it goes up when the page embeds the
                // surface again, and it replaced nothing — it is the only
                // frame the surface has on the new engine.
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

    /// Put one app's last frame up on the engine that replaced the one that
    /// had it: a sink brokered afresh, the client's dmabuf imported afresh,
    /// and the same buffer submitted and kept held.
    ///
    /// `false` is a window that will be blank until its client draws — the
    /// engine refused the dmabuf, or the buffer is no longer one, or there is
    /// no engine to ask because the dial failed. The caller says so; it is not
    /// something to leave to whoever notices the black rectangle.
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

    /// Submits a buffer as `app_id`'s window. See [`Submission`] for whose
    /// the buffer is afterward.
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
        // A frame the engine would drop is not a frame viz is holding — the
        // one release that would ever have come for it is viz's, and viz was
        // never given it -- see `engine_surfaces`. It waits instead, and goes
        // up on the embed: see `engine_waiting`.
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

    /// Put the frame that was waiting for `surface` up, now that a page has
    /// embedded it. `Ok(true)` is a frame shown; `Ok(false)` is none waiting;
    /// an `Err` is one the engine would not take, whose buffer goes back.
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

    /// Import and submit a frame for a surface a page has embedded, and hold
    /// its buffer. `false` is a buffer the engine would not import.
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
        // A hold this replaced is the *same* buffer — ids come from
        // `imports`, which is keyed on the object — so it is dropped and not
        // released. Releasing it would tell the client it may draw into the
        // buffer viz has only just been handed, which is the tear this whole
        // path exists to avoid. The one release the client is owed arrives when
        // viz is done with the submission it actually has.
        drop(self.held.hold(surface, id, buffer, now));
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
                // A page embedded this surface, which is the moment the
                // engine gains somewhere to put a frame for it. Recorded here
                // rather than left to the caller because what it decides is
                // whether `submit` may hold a buffer -- see `engine_surfaces`.
                Event::Configure { surface, .. } => {
                    self.surfaces.embedded(*surface);
                    None
                }
                Event::Copied { .. } | Event::Frame { .. } | Event::Displays(_) => None,
            })
            .collect();
        (events, releases)
    }

    /// Buffers viz has sat on past the deadline, taken back so the client can
    /// draw. Every one is a bug on the other side of the seam and the caller is
    /// expected to say so.
    pub fn overdue(&mut self, now: Instant) -> Vec<Release> {
        returned(self.held.expired(now), Returned::Expired)
    }

    /// The app's window went away. Everything the engine was holding for it
    /// comes back at once: no release will ever arrive for a surface that is
    /// gone, and waiting out the deadline for each would stall a client that
    /// is still running for no reason.
    pub fn window_gone(&mut self, app_id: &str) -> Vec<Release> {
        self.crops.remove(app_id);
        let Some(surface) = self.surfaces.forget(app_id) else {
            return Vec::new();
        };
        // The browser holds a SharedImage, and the GPU process the dmabuf's
        // fds, for every buffer this window ever showed, until it is told
        // otherwise. A window that went without saying so leaked them all, and
        // a desk that opens and closes enough windows ran the GPU process out
        // of fds -- which ended in a `CHECK` on a fence it could not dup.
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

    /// The client destroyed a `wl_buffer`. Drops the import so its fds go, and
    /// hands back the hold if the engine still had it — no release will arrive
    /// for a buffer whose object is gone.
    pub fn buffer_destroyed(&mut self, buffer: &wl_buffer::WlBuffer) -> Option<Release> {
        // A frame waiting for an embed whose buffer is gone has nothing left
        // to put up. It was never imported, so there is nothing else to drop.
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

    /// The compositor dropped one of its own buffers. Drops the import so the
    /// browser lets go of its fds. Only a buffer viz is not holding is ever
    /// dropped — see [`crate::uploads`] — so there is no hold to hand back.
    pub fn upload_dropped(&mut self, upload: UploadId) {
        if let Some((surface, id)) = self.imports.remove(&ImportKey::Upload(upload)) {
            self.engine.forget(surface, id);
        }
    }

    /// THROWAWAY. See [`crate::engine::Engine::spike_window_center`].
    pub fn spike_window_center(&self) -> Option<u32> {
        self.engine.spike_window_center()
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
    /// surface.
    pub fn app_for(&self, surface: SurfaceId) -> Option<&str> {
        self.surfaces.app_for(surface)
    }

    /// The one surface for `app_id`, brokered on first use. `None` if the
    /// browser refused, which is logged once rather than every frame.
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

/// Holds that are no longer held, as the releases their clients are owed.
///
/// The id goes and the surface stays, because a `wl_buffer.release` names the
/// buffer the client already has and the surface is what a caller needs to say
/// WHOSE window it was — see [`Release::surface`].
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

/// Every import recorded against `surface`, taken out of `imports`, as the ids
/// the engine has to be told to forget.
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
