//! Handing a committed app frame to the engine: its dmabuf, or a copy of its shm
//! buffer (see `crate::uploads`).

use std::os::fd::OwnedFd;
use std::time::Instant;

use smithay::reexports::wayland_server::protocol::{wl_buffer, wl_surface::WlSurface};
use smithay::wayland::compositor::with_states;
use tracing::warn;

use crate::buffer_transform::Sampled;
use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_descriptor::DmabufDescriptor;
use crate::engine_session::{EngineSession, Submission, Submitted};
use crate::shm_upload::{render_modifiers, shm_shape, CopyError};
use crate::surface_commit::{committed_buffer, CommittedBuffer};
use crate::uploads::UploadId;
use crate::DomicileCompositor;
use crate::{casting, engine_damage, gbm, shm_upload};

/// What became of a committed app frame. See
/// [`DomicileCompositor::publish_frame`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Published {
    /// The engine did not take it; the window keeps its previous frame.
    NotShown,
    /// The engine samples the client's dmabuf directly, so viz owns it until
    /// released.
    Held,
    /// The engine took a copy, uploaded as `fourcc`, so the client's buffer
    /// is already free.
    Copied { fourcc: u32 },
    /// The frame waits for a page to embed the window (see `engine_waiting`)
    /// or for its buffer's import (see `engine_imports`). `held` is as in
    /// [`Published::Held`].
    Waiting { held: bool },
}

/// An app's commit with a buffer, as [`DomicileCompositor::publish_frame`]
/// shows it.
pub struct Commit<'a> {
    pub surface: &'a WlSurface,
    pub buffer: &'a wl_buffer::WlBuffer,
    pub sampled: Sampled,
    /// The box to show it at. See [`crate::configure_answers`].
    pub at_box: u64,
    /// That box's size in device pixels, if the compositor knows it.
    pub box_size: Option<(u32, u32)>,
    /// The client's damage in buffer pixels, `(x, y, width, height)`. `None`
    /// when unknown or not exact.
    pub damage: Option<(i32, i32, i32, i32)>,
}

/// An shm frame in one of the compositor's buffers, ready to submit.
struct CopiedFrame {
    id: UploadId,
    descriptor: DmabufDescriptor,
    /// The format the surface's texture now holds it in.
    fourcc: u32,
    /// Signals when the copy lands. `None` when the copy was waited for.
    fence: Option<OwnedFd>,
}

/// Why an shm client's frame could not be shown. Logged once per client.
#[derive(Debug, thiserror::Error)]
enum ShmRefused {
    #[error(
        "this client drew into shared memory, and there is no EGL renderer to copy its \
         frames to the GPU with"
    )]
    NoRenderer,
    #[error(
        "this client drew into shared memory, and there is no libgbm device to allocate the \
         GPU buffers its frames are copied into — the startup log says why"
    )]
    NoAllocator,
    #[error(
        "this client's shared-memory buffer could not be read, or is in a format with no DRM \
         equivalent"
    )]
    Unreadable,
    #[error("could not allocate a GPU buffer to copy this client's frame into: {0}")]
    Allocation(#[from] gbm::AllocationError),
    #[error("could not copy this client's frame to the GPU: {0}")]
    Copy(#[from] CopyError),
}

impl DomicileCompositor {
    /// Show this app's frame and report what happened to the client's buffer.
    ///
    /// [`Published::Held`] means viz is sampling the client's dmabuf and the
    /// caller must not release it. Otherwise the caller releases it.
    ///
    /// Every frame reaches the engine as a dmabuf; shm frames are copied first
    /// (see [`crate::uploads`]).
    pub fn publish_frame(&mut self, app_id: &str, commit: &Commit) -> Published {
        let Some(committed) = committed_buffer(commit.buffer) else {
            return Published::NotShown;
        };
        if self.engine.is_none() {
            return Published::NotShown;
        }
        let damage = self.shown.damage(
            app_id,
            engine_damage::Next {
                damage: commit.damage,
                at_box: commit.at_box,
                box_size: commit.box_size,
                crop: commit.sampled.crop,
                buffer: committed.size(),
            },
        );
        let published = match &committed {
            CommittedBuffer::Gpu(dmabuf) => {
                let published = self.submit_to_the_engine(
                    app_id,
                    Submitted::Client(commit.buffer.clone()),
                    &descriptor_from(dmabuf),
                    None,
                    commit,
                    damage,
                    Published::Held,
                );
                if published != Published::NotShown {
                    self.casting.shown(
                        app_id,
                        casting::Shown {
                            dmabuf: dmabuf.clone(),
                            sampled: commit.sampled,
                        },
                    );
                }
                published
            }
            CommittedBuffer::Pixels { .. } => self.publish_shm_frame(app_id, commit, damage),
        };
        if matches!(published, Published::Held | Published::Copied { .. }) {
            self.frame_shown(app_id);
        }
        published
    }

    /// Submit `submitted` as `app_id`'s frame, damaging `damage` (see
    /// [`crate::engine_damage`]). Returns `shown` if the engine took it,
    /// [`Published::NotShown`] if not.
    #[allow(clippy::too_many_arguments)] // One frame's worth.
    fn submit_to_the_engine(
        &mut self,
        app_id: &str,
        submitted: Submitted,
        descriptor: &DmabufDescriptor,
        fence: Option<OwnedFd>,
        commit: &Commit,
        damage: (i32, i32, i32, i32),
        shown: Published,
    ) -> Published {
        let Some(session) = self.engine.as_mut() else {
            return Published::NotShown;
        };
        let submission = session.submit(
            app_id,
            submitted,
            descriptor,
            commit.sampled,
            damage,
            commit.at_box,
            fence,
            Instant::now(),
        );
        self.arm_the_hold_deadline();
        match submission {
            Submission::Taken { replaced } => {
                if let Some(buffer) = replaced {
                    self.returned(buffer);
                }
                shown
            }
            Submission::Waiting { replaced } => {
                if let Some(buffer) = replaced {
                    self.returned(buffer);
                }
                Published::Waiting {
                    held: shown == Published::Held,
                }
            }
            Submission::Refused => Published::NotShown,
        }
    }

    /// Copy an shm client's frame into a compositor buffer and submit that.
    ///
    /// Never [`Published::Held`]: the client's buffer is free once copied. A
    /// failed copy is logged once per client, so a blank window always has an
    /// explanation.
    fn publish_shm_frame(
        &mut self,
        app_id: &str,
        commit: &Commit,
        damage: (i32, i32, i32, i32),
    ) -> Published {
        let copied = match self.copy_shm_frame(app_id, commit) {
            Ok(copied) => copied,
            Err(why) => {
                if self.shm_refused.first(app_id) {
                    warn!(app_id, %why, "this client's window will be blank");
                }
                return Published::NotShown;
            }
        };
        let published = self.submit_to_the_engine(
            app_id,
            Submitted::Upload(copied.id),
            &copied.descriptor,
            copied.fence,
            commit,
            damage,
            Published::Copied {
                fourcc: copied.fourcc,
            },
        );
        if published == Published::NotShown {
            // Never reached viz, so nothing will release it.
            self.uploads.give_back(copied.id);
        } else {
            let dmabuf = self
                .uploads
                .get(copied.id)
                .expect("a buffer the engine holds is there")
                .clone();
            self.casting.shown(
                app_id,
                casting::Shown {
                    dmabuf,
                    sampled: commit.sampled,
                },
            );
        }
        published
    }

    /// Copy the commit's buffer into a free buffer of `app_id`'s.
    ///
    /// The client's pixels reach the GPU through a texture kept on the
    /// surface, so only the damage is uploaded while it holds the previous
    /// commit.
    ///
    /// The buffer comes back taken; the caller gives it back if the engine
    /// does not take it.
    ///
    /// An engine that takes fences gets the copy's, so this thread does not
    /// wait for the GPU.
    fn copy_shm_frame(&mut self, app_id: &str, commit: &Commit) -> Result<CopiedFrame, ShmRefused> {
        let fenced = self
            .engine
            .as_ref()
            .is_some_and(EngineSession::takes_fences);
        let gpu = self.gpu.as_mut().ok_or(ShmRefused::NoRenderer)?;
        let gbm = gpu.gbm.as_ref().ok_or(ShmRefused::NoAllocator)?;
        let shape = shm_shape(commit.buffer).ok_or(ShmRefused::Unreadable)?;
        let modifiers = render_modifiers(&gpu.renderer, shape.fourcc);
        let taken = self
            .uploads
            .take(app_id, shape, |shape| gbm.allocate(shape, &modifiers))?;
        if let Some(session) = self.engine.as_mut() {
            for dropped in &taken.dropped {
                session.upload_dropped(*dropped);
            }
        }
        let target = self
            .uploads
            .get_mut(taken.id)
            .expect("a buffer just taken is there");
        let size = (shape.width as i32, shape.height as i32).into();
        let damage = shm_upload::uploaded(
            commit.damage,
            self.shown.texture_is_current(app_id, shape.fourcc),
            (shape.width, shape.height),
        );
        let copied = with_states(commit.surface, |states| {
            shm_upload::import(&mut gpu.renderer, commit.buffer, states, shape, &damage)
        })
        .map_err(CopyError::from)
        .and_then(|texture| shm_upload::copy(&mut gpu.renderer, &texture, target, size, fenced));
        match copied {
            Ok(fence) => Ok(CopiedFrame {
                id: taken.id,
                descriptor: descriptor_from(target),
                fourcc: shape.fourcc,
                fence,
            }),
            Err(err) => {
                self.uploads.give_back(taken.id);
                Err(ShmRefused::Copy(err))
            }
        }
    }
}
