//! Tracks which per-window GPU buffers for shm frames are free.
//!
//! The engine imports only dmabufs, so the compositor copies each `wl_shm`
//! frame into a buffer of its own and releases the client's buffer after the
//! copy.
//!
//! - A buffer stays out until viz releases it. Copying into one that is out
//!   would tear.
//! - When every buffer is out, a new one is allocated instead of waiting.
//! - After a resize, buffers of the old shape are dropped once free.
//!   [`Uploads::take`] returns their ids so the caller can tell the engine.

use std::collections::HashMap;

/// The engine session's id for one of the compositor's buffers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UploadId(u64);

/// A buffer's size and DRM fourcc.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    pub width: u32,
    pub height: u32,
    pub fourcc: u32,
}

/// The buffer [`Uploads::take`] handed out, and the buffers it dropped.
#[derive(Debug, PartialEq, Eq)]
pub struct Taken {
    pub id: UploadId,
    /// Stale-shaped buffers. The caller must tell the engine to forget each.
    pub dropped: Vec<UploadId>,
}

#[derive(Debug)]
struct Slot<B> {
    id: UploadId,
    shape: Shape,
    buffer: B,
    out: bool,
}

/// Every window's buffers, by window, so a commit looks only at its own.
#[derive(Debug)]
pub struct Uploads<B> {
    windows: HashMap<String, Vec<Slot<B>>>,
    /// The window each buffer belongs to.
    owners: HashMap<UploadId, String>,
    next: u64,
}

impl<B> Default for Uploads<B> {
    fn default() -> Self {
        Self {
            windows: HashMap::new(),
            owners: HashMap::new(),
            next: 1,
        }
    }
}

impl<B> Uploads<B> {
    /// Marks a free `shape` buffer for `app_id` as out, allocating one if none
    /// is free.
    ///
    /// On allocation failure nothing is marked out.
    pub fn take<E>(
        &mut self,
        app_id: &str,
        shape: Shape,
        allocate: impl FnOnce(Shape) -> Result<B, E>,
    ) -> Result<Taken, E> {
        let dropped = self.drop_stale(app_id, shape);
        let free = self
            .windows
            .get_mut(app_id)
            .and_then(|slots| slots.iter_mut().find(|slot| !slot.out));
        let id = match free {
            Some(slot) => {
                slot.out = true;
                slot.id
            }
            None => {
                let buffer = allocate(shape)?;
                let id = UploadId(self.next);
                self.next += 1;
                self.owners.insert(id, app_id.to_owned());
                self.windows
                    .entry(app_id.to_owned())
                    .or_default()
                    .push(Slot {
                        id,
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
        self.owners
            .get(&id)
            .and_then(|app_id| self.windows.get(app_id))
            .and_then(|slots| slots.iter().find(|slot| slot.id == id))
            .map(|slot| &slot.buffer)
    }

    /// The buffer behind `id`, to copy into.
    pub fn get_mut(&mut self, id: UploadId) -> Option<&mut B> {
        self.slot_mut(id).map(|slot| &mut slot.buffer)
    }

    /// Marks `id` free: viz released it, or its frame never reached viz. A
    /// dropped id is ignored.
    pub fn give_back(&mut self, id: UploadId) {
        if let Some(slot) = self.slot_mut(id) {
            slot.out = false;
        }
    }

    /// Drops every buffer of a closed window and returns their ids, as
    /// [`Taken::dropped`] does.
    pub fn forget(&mut self, app_id: &str) -> Vec<UploadId> {
        let gone: Vec<UploadId> = self
            .windows
            .remove(app_id)
            .unwrap_or_default()
            .into_iter()
            .map(|slot| slot.id)
            .collect();
        for id in &gone {
            self.owners.remove(id);
        }
        gone
    }

    /// Drops `app_id`'s free buffers that are not `shape`.
    ///
    /// Buffers viz still holds are kept until they come back, so the import is
    /// not removed while viz reads it.
    fn drop_stale(&mut self, app_id: &str, shape: Shape) -> Vec<UploadId> {
        let Some(slots) = self.windows.get_mut(app_id) else {
            return Vec::new();
        };
        let stale: Vec<UploadId> = slots
            .extract_if(.., |slot| !slot.out && slot.shape != shape)
            .map(|slot| slot.id)
            .collect();
        for id in &stale {
            self.owners.remove(id);
        }
        stale
    }

    fn slot_mut(&mut self, id: UploadId) -> Option<&mut Slot<B>> {
        self.owners
            .get(&id)
            .and_then(|app_id| self.windows.get_mut(app_id))
            .and_then(|slots| slots.iter_mut().find(|slot| slot.id == id))
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

    /// An allocator that returns the requested shape and never fails.
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
