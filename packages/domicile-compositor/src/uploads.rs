//! The GPU buffers an shm client's frames are copied into.
//!
//! The engine imports a dmabuf and nothing else, and a client that draws into
//! `wl_shm` has none. So the compositor keeps a few of its own per window,
//! copies each shm frame into a free one and submits that — and the client's
//! buffer goes back to it the moment the copy is done, because nothing samples
//! it after that.
//!
//! What this module owns is which of those buffers is free. A buffer handed to
//! the engine is viz's until viz releases it, exactly as a client's dmabuf is,
//! so a copy never goes into one that is out: that is the tear. A window with
//! every buffer out gets another one rather than waiting, because waiting is a
//! client whose frame is not shown.
//!
//! **A buffer is the shape of the frame copied into it.** A window that resized
//! has buffers of the old shape, and those are dropped the next time the
//! window takes one — the free ones then, the ones viz still has once it gives
//! them back. Every dropped one is the caller's to tell the engine about, which
//! is why [`Uploads::take`] hands their ids back.

/// One of the compositor's buffers, as the engine session knows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UploadId(u64);

/// What a frame needs a buffer to be: its size and its DRM fourcc.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    pub width: u32,
    pub height: u32,
    pub fourcc: u32,
}

/// A free buffer, and the buffers this take dropped.
#[derive(Debug, PartialEq, Eq)]
pub struct Taken {
    pub id: UploadId,
    /// Buffers of a shape this window no longer draws at. Each is an import
    /// the engine is still keeping, and the caller's to forget.
    pub dropped: Vec<UploadId>,
}

#[derive(Debug)]
struct Slot<B> {
    id: UploadId,
    app_id: String,
    shape: Shape,
    buffer: B,
    out: bool,
}

/// Every window's buffers.
#[derive(Debug)]
pub struct Uploads<B> {
    slots: Vec<Slot<B>>,
    next: u64,
}

impl<B> Default for Uploads<B> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            next: 1,
        }
    }
}

impl<B> Uploads<B> {
    /// A buffer of `shape` for `app_id` that nothing is reading, marked out.
    ///
    /// One is allocated when the window has none free. An allocation that
    /// fails is the caller's error, and nothing is marked out for it.
    pub fn take<E>(
        &mut self,
        app_id: &str,
        shape: Shape,
        allocate: impl FnOnce(Shape) -> Result<B, E>,
    ) -> Result<Taken, E> {
        let dropped = self.drop_stale(app_id, shape);
        let free = self
            .slots
            .iter_mut()
            .find(|slot| slot.app_id == app_id && !slot.out);
        let id = match free {
            Some(slot) => {
                slot.out = true;
                slot.id
            }
            None => {
                let buffer = allocate(shape)?;
                let id = UploadId(self.next);
                self.next += 1;
                self.slots.push(Slot {
                    id,
                    app_id: app_id.to_owned(),
                    shape,
                    buffer,
                    out: true,
                });
                id
            }
        };
        Ok(Taken { id, dropped })
    }

    /// The buffer behind `id`, to describe.
    pub fn get(&self, id: UploadId) -> Option<&B> {
        self.slots
            .iter()
            .find(|slot| slot.id == id)
            .map(|slot| &slot.buffer)
    }

    /// The buffer behind `id`, to copy into.
    pub fn get_mut(&mut self, id: UploadId) -> Option<&mut B> {
        self.slots
            .iter_mut()
            .find(|slot| slot.id == id)
            .map(|slot| &mut slot.buffer)
    }

    /// Nothing is reading `id` any more: viz released it, or the frame copied
    /// into it never reached viz. A buffer already dropped is nothing to do.
    pub fn give_back(&mut self, id: UploadId) {
        if let Some(slot) = self.slots.iter_mut().find(|slot| slot.id == id) {
            slot.out = false;
        }
    }

    /// The window is gone, and every buffer it had goes with it. Their ids are
    /// the caller's, for the same reason [`Taken::dropped`] is.
    pub fn forget(&mut self, app_id: &str) -> Vec<UploadId> {
        let (gone, kept) = std::mem::take(&mut self.slots)
            .into_iter()
            .partition(|slot| slot.app_id == app_id);
        self.slots = kept;
        gone.into_iter().map(|slot: Slot<B>| slot.id).collect()
    }

    /// Drop `app_id`'s free buffers that are not `shape`.
    ///
    /// Free ones only: a buffer viz still has is on screen, or about to stop
    /// being, and dropping it would take the import out from under viz. It
    /// is dropped by the first take after it comes back.
    fn drop_stale(&mut self, app_id: &str, shape: Shape) -> Vec<UploadId> {
        let (stale, kept) = std::mem::take(&mut self.slots)
            .into_iter()
            .partition(|slot| slot.app_id == app_id && !slot.out && slot.shape != shape);
        self.slots = kept;
        stale.into_iter().map(|slot: Slot<B>| slot.id).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{Shape, Taken, Uploads};

    const SMALL: Shape = Shape {
        width: 64,
        height: 48,
        fourcc: 0x3432_5241,
    };
    const LARGE: Shape = Shape {
        width: 640,
        height: 480,
        fourcc: 0x3432_5241,
    };

    /// An allocator that names each buffer after the shape it was asked for,
    /// and never fails.
    fn allocate(shape: Shape) -> Result<Shape, ()> {
        Ok(shape)
    }

    fn take(uploads: &mut Uploads<Shape>, app_id: &str, shape: Shape) -> Taken {
        uploads.take(app_id, shape, allocate).expect("never fails")
    }

    #[test]
    fn a_buffer_viz_has_is_never_handed_out_again() {
        let mut uploads = Uploads::default();
        let first = take(&mut uploads, "a", SMALL);
        let second = take(&mut uploads, "a", SMALL);

        assert_ne!(first.id, second.id);
    }

    #[test]
    fn a_buffer_given_back_is_the_next_one_taken() {
        let mut uploads = Uploads::default();
        let first = take(&mut uploads, "a", SMALL);
        uploads.give_back(first.id);

        assert_eq!(take(&mut uploads, "a", SMALL).id, first.id);
    }

    #[test]
    fn one_windows_free_buffer_is_not_anothers() {
        let mut uploads = Uploads::default();
        let theirs = take(&mut uploads, "a", SMALL);
        uploads.give_back(theirs.id);

        assert_ne!(take(&mut uploads, "b", SMALL).id, theirs.id);
    }

    #[test]
    fn a_resize_drops_the_free_buffers_of_the_old_shape() {
        let mut uploads = Uploads::default();
        let old = take(&mut uploads, "a", SMALL);
        uploads.give_back(old.id);

        let new = take(&mut uploads, "a", LARGE);

        assert_eq!(new.dropped, vec![old.id]);
        assert_eq!(*uploads.get(new.id).expect("taken"), LARGE);
        assert!(uploads.get(old.id).is_none());
    }

    #[test]
    fn a_resize_keeps_the_old_buffer_viz_is_reading_until_it_comes_back() {
        let mut uploads = Uploads::default();
        let old = take(&mut uploads, "a", SMALL);

        let new = take(&mut uploads, "a", LARGE);
        assert!(new.dropped.is_empty());
        assert!(uploads.get(old.id).is_some());

        uploads.give_back(old.id);
        uploads.give_back(new.id);
        assert_eq!(take(&mut uploads, "a", LARGE).dropped, vec![old.id]);
    }

    #[test]
    fn a_failed_allocation_leaves_nothing_out() {
        let mut uploads: Uploads<Shape> = Uploads::default();
        assert_eq!(uploads.take("a", SMALL, |_| Err("no gpu")), Err("no gpu"));

        let taken = take(&mut uploads, "a", SMALL);
        uploads.give_back(taken.id);
        assert_eq!(take(&mut uploads, "a", SMALL).id, taken.id);
    }

    #[test]
    fn a_window_that_goes_takes_every_buffer_with_it() {
        let mut uploads = Uploads::default();
        let out = take(&mut uploads, "a", SMALL);
        let free = take(&mut uploads, "a", SMALL);
        uploads.give_back(free.id);
        let other = take(&mut uploads, "b", SMALL);

        let mut gone = uploads.forget("a");
        gone.sort_by_key(|id| id.0);

        assert_eq!(gone, vec![out.id, free.id]);
        assert!(uploads.get(other.id).is_some());
    }

    #[test]
    fn giving_back_a_dropped_buffer_is_nothing() {
        let mut uploads = Uploads::default();
        let taken = take(&mut uploads, "a", SMALL);
        uploads.forget("a");

        uploads.give_back(taken.id);

        assert!(uploads.get_mut(taken.id).is_none());
    }
}
