//! The surface commit path: what a client's `wl_surface.commit` does with its
//! buffer, and the buffer protocols.

use std::time::Instant;

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;
use smithay::reexports::wayland_server::{
    protocol::{wl_buffer, wl_surface::WlSurface},
    Client,
};
use smithay::utils::Transform;
use smithay::wayland::presentation::PresentationFeedbackCachedState;
use smithay::wayland::viewporter::ViewportCachedState;
use smithay::wayland::{
    buffer::BufferHandler,
    compositor::{
        with_states, BufferAssignment, CompositorClientState, CompositorHandler, CompositorState,
        SurfaceAttributes, SurfaceData,
    },
    dmabuf::{get_dmabuf, DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier},
    shell::xdg::{PopupSurface, SurfaceCachedState, ToplevelSurface, XdgToplevelSurfaceData},
    shm::with_buffer_contents,
    shm::{ShmHandler, ShmState},
};
use smithay::{
    delegate_compositor, delegate_content_type, delegate_dmabuf, delegate_presentation,
    delegate_shm, delegate_single_pixel_buffer, delegate_viewporter,
};
use tracing::debug;

use crate::buffer_transform::{crop_in_buffer, upright_size, Sampled};
use crate::client_damage::take_damage;
use crate::clients::ClientState;
use crate::dmabuf_import::DmabufImporter;
use crate::engine::NEWEST_BOX;
use crate::engine_damage;
use crate::frame_pacing::Paced;
use crate::frame_publishing::{Commit, Published};
use crate::scale::logical_size;
use crate::viewport::{source_pixels, surface_size, Viewport};
use crate::window_geometry::window_size;
use crate::DomicileCompositor;

/// What the compositor needs to know about a client's latest commit: source,
/// orientation and size. The pixels go to the engine untouched.
struct SurfaceTexture {
    /// Whether the buffer was a dmabuf or shm. Logged, since an shm frame costs
    /// an upload.
    from_dmabuf: bool,
    /// Whether the buffer is flipped, as GL clients flag on the dmabuf.
    y_inverted: bool,
    /// The surface's own logical size, or its `wp_viewport` destination if set.
    ///
    /// Not the output's: a client that has not answered a configure is still
    /// its old size, and stretching it would hide that.
    logical_size: (f64, f64),
}

/// The role a surface committed in, for the steps of a commit that differ.
#[derive(Clone)]
pub enum Role {
    Toplevel(ToplevelSurface),
    Popup(PopupSurface),
    Bubble,
}

/// Which of the two kinds of client committed a buffer.
#[derive(Debug)]
enum Committer {
    /// A window on the desktop, named by the id the host gave it.
    App(String),
    /// The engine drawing the desktop itself.
    Chrome,
}

pub enum CommittedBuffer {
    Pixels { width: u32, height: u32 },
    Gpu(Dmabuf),
}

impl CommittedBuffer {
    /// The buffer's size, known without reading pixels.
    pub fn size(&self) -> (u32, u32) {
        match self {
            CommittedBuffer::Pixels { width, height, .. } => (*width, *height),
            CommittedBuffer::Gpu(dmabuf) => (dmabuf.width(), dmabuf.height()),
        }
    }
}

impl CompositorHandler for DomicileCompositor {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        &client.get_data::<ClientState>().unwrap().compositor_state
    }

    fn commit(&mut self, surface: &WlSurface) {
        self.announce_a_new_popup(surface);
        self.place_the_bubbles(surface);
        let Some((committer, role)) = self.committer(surface) else {
            return;
        };
        // Send the initial configure once, so the client can map. A popup's was
        // sent in `new_popup`.
        if let Role::Toplevel(toplevel) = &role {
            let initial_configure_sent = with_states(surface, |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .unwrap()
                    .lock()
                    .unwrap()
                    .initial_configure_sent
            });
            if !initial_configure_sent {
                toplevel.send_configure();
            }
        }

        if let Committer::App(app_id) = &committer {
            self.tell_the_size_limits(app_id, surface);
        }
        // A commit answers the client's last resize, so the newest one may go
        // out.
        if let (Committer::App(app_id), Role::Toplevel(toplevel)) = (&committer, &role) {
            let acked = with_states(surface, |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .unwrap()
                    .lock()
                    .unwrap()
                    .current_serial
            });
            let waiting = self
                .configure_answers
                .get_mut(app_id)
                .and_then(|answers| answers.committed(acked));
            if let Some(resize) = waiting {
                self.send_resize(app_id, toplevel, resize);
            }
        }

        // Take the new buffer and the frame callbacks. Taking the buffer gives
        // us its release; otherwise Smithay holds it until the next buffer,
        // which the client may need the release to draw.
        let (attached, callbacks, buffer_scale, buffer_transform, viewport, geometry, damage) =
            with_states(surface, |states| {
                // Read with the buffer: the viewport is double-buffered and
                // applies to this commit.
                let viewport = {
                    let mut cached = states.cached_state.get::<ViewportCachedState>();
                    let state = cached.current();
                    Viewport {
                        destination: state.dst.map(|size| (size.w, size.h)),
                        source: state
                            .src
                            .map(|rect| (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h)),
                    }
                };
                let mut guard = states.cached_state.get::<SurfaceAttributes>();
                let attrs = guard.current();
                let attached = match attrs.buffer.take() {
                    Some(BufferAssignment::NewBuffer(buffer)) => (Some(buffer), false),
                    Some(BufferAssignment::Removed) => (None, true),
                    None => (None, false),
                };
                let callbacks = std::mem::take(&mut attrs.frame_callbacks);
                // Clear the accumulated damage, or it grows by a rectangle per
                // commit for the window's life.
                let damage = take_damage(&mut attrs.damage, attrs.buffer_scale);
                // The scale this buffer was drawn at. Read now; a client
                // mid-scale-change may commit the next one differently.
                let scale = attrs.buffer_scale;
                let transform = Transform::from(attrs.buffer_transform);
                drop(guard);
                // Double-buffered too; see `crate::window_geometry`.
                (
                    attached,
                    callbacks,
                    scale,
                    transform,
                    viewport,
                    window_geometry(states),
                    damage,
                )
            });
        // Whether the client took its buffer away, unmapping the window.
        let (attached, unmapped) = attached;
        if let (Some(buffer), Committer::App(app_id), Role::Toplevel(toplevel)) =
            (&attached, &committer, &role)
        {
            let drawn = committed_buffer(buffer).map(|committed| {
                surface_size(
                    upright_size(committed.size(), buffer_transform),
                    buffer_scale,
                    viewport.destination,
                )
            });
            // A buffer of no known kind is not shown, so it has no size.
            if let Some(size) = window_size(geometry, drawn) {
                if self.unannounced.contains(app_id) {
                    self.announce_a_new_window(app_id, toplevel, size);
                } else {
                    self.tell_the_size(app_id, size);
                }
            }
        }
        let feedback = with_states(surface, |states| {
            std::mem::take(
                &mut states
                    .cached_state
                    .get::<PresentationFeedbackCachedState>()
                    .current()
                    .callbacks,
            )
        });

        // Ask the client to draw its next frame (keeps it animating), unless
        // the page hid its window. Sent once its frame is shown, below.
        let callbacks = match self.window_of(surface) {
            Some(window) => self.held_frames.pass(&window, callbacks),
            None => callbacks,
        };

        // A theme turnover waits for each window to draw a new frame.
        if let (Some(_), Committer::App(app_id), Some(turnover)) =
            (&attached, &committer, &mut self.turnover)
        {
            let step = turnover.repainted(app_id);
            self.follow_the_turnover(step);
        }

        // Damage without a new buffer changes pixels the engine does not show,
        // and a window mapped again starts from nothing.
        if let (None, Committer::App(app_id)) = (&attached, &committer) {
            if damage.is_some() || unmapped {
                self.shown.missed(app_id);
            }
        }

        let shown = attached.and_then(|buffer| {
            // The gap since the last commit is time spent waiting on clients or
            // the throttle.
            let started = Instant::now();
            let waited = self.last_commit.map(|done| started.duration_since(done));
            // Only app commits after a keystroke count as responses.
            // Unprompted redraws (a blinking cursor) and chrome commits would
            // skew it.
            let responded = answers_keystroke(&committer)
                .then(|| self.pending_key.take())
                .flatten()
                .map(|keyed| started.duration_since(keyed));
            let (engine_holds, shown) = match &committer {
                Committer::App(app_id) => {
                    // The size this commit was drawn for, and the engine's box
                    // at that size. See `crop` and `crate::configure_answers`.
                    let (configured, (at_box, box_size)) = match &role {
                        Role::Toplevel(toplevel) => {
                            let acked = with_states(surface, |states| {
                                states
                                    .data_map
                                    .get::<XdgToplevelSurfaceData>()
                                    .unwrap()
                                    .lock()
                                    .unwrap()
                                    .current_serial
                            });
                            (
                                toplevel.current_state().size.map(|size| (size.w, size.h)),
                                self.configure_answers.get_mut(app_id).map_or(
                                    (crate::engine::LAST_SHOWN_BOX, None),
                                    |answers| {
                                        let at_box = answers.answered(acked);
                                        (at_box, answers.box_size(at_box))
                                    },
                                ),
                            )
                        }
                        // The positioner's size, which the shell places.
                        Role::Popup(popup) => (
                            popup.with_pending_state(|state| {
                                Some((state.geometry.size.w, state.geometry.size.h))
                            }),
                            (NEWEST_BOX, None),
                        ),
                        // Sized by its own buffer.
                        Role::Bubble => (None, (NEWEST_BOX, None)),
                    };
                    // Measured on the upright buffer, then mapped back into
                    // the buffer the engine samples.
                    let buffer_size = committed_buffer(&buffer).map(|committed| committed.size());
                    let crop = buffer_size.map_or((0, 0, 0, 0), |buffer_size| {
                        let size = upright_size(buffer_size, buffer_transform);
                        crop_in_buffer(
                            crate::window_geometry::crop(
                                geometry,
                                configured,
                                surface_size(size, buffer_scale, viewport.destination),
                                size,
                                source_pixels(size, buffer_scale, viewport.source),
                            ),
                            size,
                            buffer_transform,
                        )
                    });
                    let sampled = Sampled {
                        crop,
                        transform: buffer_transform,
                    };
                    self.cast_frame(app_id, &buffer, sampled, buffer_scale, damage);
                    // Surface damage maps to buffer pixels by the scale alone
                    // only when nothing turns or scales the buffer.
                    let upright =
                        buffer_transform == Transform::Normal && viewport == Viewport::default();
                    let commit = Commit {
                        surface,
                        buffer: &buffer,
                        sampled,
                        at_box,
                        box_size,
                        damage: damage.filter(|_| upright).map(|region| {
                            (
                                region.x as i32,
                                region.y as i32,
                                region.width as i32,
                                region.height as i32,
                            )
                        }),
                    };
                    let published = self.publish_frame(app_id, &commit);
                    match published {
                        Published::Held | Published::Copied { .. } => self.shown.shown(
                            app_id,
                            engine_damage::Frame {
                                at_box,
                                crop,
                                buffer: buffer_size.expect("a shown frame has a buffer"),
                                upright,
                                texture: match published {
                                    Published::Copied { fourcc } => Some(fourcc),
                                    _ => None,
                                },
                            },
                        ),
                        Published::Waiting { .. } | Published::NotShown => {
                            self.shown.missed(app_id)
                        }
                    }
                    // After the submit, so there is something to sample, but
                    // timed from `started` so the import and submit count as
                    // ours.
                    self.drive_latency(
                        app_id,
                        started,
                        matches!(published, Published::Held | Published::Copied { .. }),
                    );
                    // The frame the engine will report, if it reached viz or
                    // goes up later.
                    let shown = match published {
                        Published::Held | Published::Copied { .. } => self
                            .engine
                            .as_ref()
                            .and_then(|session| session.frame_of(app_id))
                            .map(|frame| Paced::Submitted(app_id.clone(), frame)),
                        Published::Waiting { .. } => Some(Paced::Held(app_id.clone())),
                        Published::NotShown => None,
                    };
                    (
                        matches!(
                            published,
                            Published::Held | Published::Waiting { held: true }
                        ),
                        shown,
                    )
                }
                Committer::Chrome => {
                    self.publish_chrome_frame(&buffer, buffer_scale, viewport);
                    (false, None)
                }
            };
            // Release after the pixels are out, since the client may redraw
            // into it immediately. Always release, or a single-buffered client
            // stops drawing.
            //
            // Except a buffer the engine holds: viz samples it directly, so
            // releasing it would tear. The engine releases it, or
            // `EngineSession::overdue` takes it back.
            if !engine_holds {
                buffer.release();
                tracing::trace!(?committer, "buffer released");
            }
            let done = Instant::now();
            {
                let mut timings = self.hub.timings.lock().unwrap();
                if let Some(waited) = waited {
                    timings.idle.record(waited);
                }
                if let Some(responded) = responded {
                    timings.response.record(responded);
                }
                timings.commit.record(done - started);
            }
            self.last_commit = Some(done);
            shown
        });
        self.answer_when_shown(shown, callbacks, feedback);
    }

    /// A destroyed bubble goes at once: no commit will come to notice it.
    fn destroyed(&mut self, surface: &WlSurface) {
        if let Some(at) = self
            .bubbles
            .iter()
            .position(|bubble| bubble.surface == *surface)
        {
            let bubble = self.bubbles.remove(at);
            self.by_surface.remove(&bubble.surface);
            debug!(app_id = %bubble.app_id, "bubble destroyed -> Host::app_closed");
            self.forget(&bubble.app_id);
        }
    }
}

impl BufferHandler for DomicileCompositor {
    /// The client destroyed a buffer. Drop its import so the browser releases
    /// the fds, and forget any hold.
    fn buffer_destroyed(&mut self, buffer: &wl_buffer::WlBuffer) {
        if let Some(session) = self.engine.as_mut() {
            if !session.buffer_destroyed(buffer).is_empty() {
                tracing::debug!("a buffer the engine still held was destroyed by its client");
            }
        }
    }
}

impl ShmHandler for DomicileCompositor {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}

impl DmabufHandler for DomicileCompositor {
    fn dmabuf_state(&mut self) -> &mut DmabufState {
        &mut self.dmabuf_state
    }

    // Validate a client's dmabuf by importing it. This also warms the
    // renderer's cache for the following commit.
    fn dmabuf_imported(
        &mut self,
        _global: &DmabufGlobal,
        dmabuf: Dmabuf,
        notifier: ImportNotifier,
    ) {
        let gpu = self
            .gpu
            .as_mut()
            .expect("the dmabuf global is only advertised alongside a renderer");
        if DmabufImporter::accepts(gpu.renderer(), &dmabuf) {
            if let Err(err) = notifier.successful::<DomicileCompositor>() {
                tracing::debug!(?err, "client went away before its dmabuf was acknowledged");
            }
        } else {
            tracing::warn!(format = ?dmabuf.format(), "rejecting a dmabuf the renderer cannot import");
            notifier.failed();
        }
    }
}

delegate_compositor!(DomicileCompositor);

delegate_viewporter!(DomicileCompositor);

delegate_presentation!(DomicileCompositor);

delegate_single_pixel_buffer!(DomicileCompositor);

delegate_content_type!(DomicileCompositor);

delegate_shm!(DomicileCompositor);

delegate_dmabuf!(DomicileCompositor);

impl DomicileCompositor {
    /// Who committed `surface`, and in which role. Roles differ only in where
    /// the buffer goes and the requested size.
    fn committer(&self, surface: &WlSurface) -> Option<(Committer, Role)> {
        if let Some(chrome) = &self.chrome_toplevel {
            if chrome.wl_surface() == surface {
                return Some((Committer::Chrome, Role::Toplevel(chrome.clone())));
            }
        }
        self.by_surface
            .get(surface)
            .map(|(app_id, role)| (Committer::App(app_id.clone()), role.clone()))
    }

    /// Log the chrome frame's shape when it changes.
    ///
    /// The engine draws it, so nothing is kept.
    /// `e2e-chrome-fills-the-desktop.sh` reads the size from this line.
    fn publish_chrome_frame(
        &mut self,
        buffer: &wl_buffer::WlBuffer,
        buffer_scale: i32,
        viewport: Viewport,
    ) {
        let texture = committed_buffer(buffer)
            .and_then(|committed| self.texture_from(committed, buffer_scale, viewport));
        // Log on change. The buffer type, size and orientation explain a frame
        // that is the wrong size or upside down.
        let shape = texture.as_ref().map(|surface| {
            (
                surface.logical_size,
                surface.y_inverted,
                surface.from_dmabuf,
            )
        });
        if shape != self.chrome_frame_shape {
            self.chrome_frame_shape = shape;
            match shape {
                Some(((width, height), y_inverted, from_dmabuf)) => debug!(
                    width,
                    height,
                    y_inverted,
                    dmabuf = from_dmabuf,
                    scale = buffer_scale,
                    "the chrome committed a frame"
                ),
                None => debug!("the chrome's frame could not be made into a texture"),
            }
        }
    }

    /// Describe a committed buffer, dmabuf or shm.
    fn texture_from(
        &mut self,
        committed: CommittedBuffer,
        buffer_scale: i32,
        viewport: Viewport,
    ) -> Option<SurfaceTexture> {
        let (width, height) = committed.size();
        // The buffer's logical size, which a viewport source rectangle is
        // relative to. Not the surface size, which a viewport destination
        // replaces.
        let (buffer_width, buffer_height) = logical_size((width, height), buffer_scale);
        let _buffer_logical = (f64::from(buffer_width), f64::from(buffer_height));
        let (logical_width, logical_height) =
            surface_size((width, height), buffer_scale, viewport.destination);
        let logical_size = (f64::from(logical_width), f64::from(logical_height));
        match committed {
            CommittedBuffer::Gpu(dmabuf) => Some(SurfaceTexture {
                from_dmabuf: true,
                // GL clients flag a flipped buffer on the dmabuf.
                y_inverted: dmabuf.y_inverted(),
                logical_size,
            }),
            CommittedBuffer::Pixels { .. } => Some(SurfaceTexture {
                from_dmabuf: false,
                // Shm is laid out top-down.
                y_inverted: false,
                logical_size,
            }),
        }
    }
}

/// Whether this commit can answer a forwarded keystroke.
///
/// Only app windows can. The chrome repaints for its own reasons (a ticking
/// clock), and counting those would misreport the wait.
fn answers_keystroke(committer: &Committer) -> bool {
    match committer {
        Committer::App(_) => true,
        Committer::Chrome => false,
    }
}

/// Classify a committed buffer: a dmabuf if one is attached as user data,
/// otherwise shm.
pub fn committed_buffer(buffer: &wl_buffer::WlBuffer) -> Option<CommittedBuffer> {
    match get_dmabuf(buffer) {
        Ok(dmabuf) => Some(CommittedBuffer::Gpu(dmabuf.clone())),
        Err(_) => {
            shm_buffer_size(buffer).map(|(width, height)| CommittedBuffer::Pixels { width, height })
        }
    }
}

/// The size of a `wl_shm` buffer.
fn shm_buffer_size(buffer: &wl_buffer::WlBuffer) -> Option<(u32, u32)> {
    with_buffer_contents(buffer, |_ptr, _len, data| {
        Some((data.width.max(0) as u32, data.height.max(0) as u32))
    })
    .ok()
    .flatten()
}

/// The surface's committed `xdg_surface.set_window_geometry`, as `(x, y, width,
/// height)` in logical units.
pub fn window_geometry(states: &SurfaceData) -> Option<(i32, i32, i32, i32)> {
    states
        .cached_state
        .get::<SurfaceCachedState>()
        .current()
        .geometry
        .map(|rect| (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h))
}

#[cfg(test)]
mod tests {
    use super::{answers_keystroke, Committer};

    #[test]
    fn a_window_can_be_the_answer_to_a_keystroke() {
        assert!(answers_keystroke(&Committer::App("term".to_string())));
    }

    #[test]
    fn the_chromes_own_repaint_is_not_an_answer_to_a_keystroke() {
        // The chrome repaints for its own reasons; counting those would
        // misreport the wait.
        assert!(!answers_keystroke(&Committer::Chrome));
    }
}
