//! The last frame each surface committed before a page embedded it.
//!
//! The engine drops a frame for a surface no page has embedded — see
//! `engine_surfaces` — and a window gets over that because the embed resizes
//! it, and a client told a new size draws again. A popup is not resized: it is
//! placed at the size its client asked for, and a menu draws once and waits
//! for the pointer. Released, that one frame is gone and the menu is blank
//! until something is hovered. Kept here instead, it goes up the moment the
//! page embeds the surface.
//!
//! One per surface, the newest: a frame that is waiting is out of date the
//! moment another arrives, and the older buffer goes back to whoever owns it.

use std::collections::HashMap;

use crate::engine::SurfaceId;

/// The frames waiting for an embed, by surface. What a frame is — a buffer
/// and how to submit it — is the session's.
#[derive(Debug)]
pub struct Waiting<F> {
    frames: HashMap<SurfaceId, F>,
}

impl<F> Default for Waiting<F> {
    fn default() -> Self {
        Waiting {
            frames: HashMap::new(),
        }
    }
}

impl<F> Waiting<F> {
    /// Keep `frame` until `surface` is embedded. Answers the frame it
    /// replaces, whose buffer the caller gives back.
    pub fn wait(&mut self, surface: SurfaceId, frame: F) -> Option<F> {
        self.frames.insert(surface, frame)
    }

    /// The frame waiting for `surface`, taken now that it has somewhere to go
    /// — or because the surface is gone.
    pub fn take(&mut self, surface: SurfaceId) -> Option<F> {
        self.frames.remove(&surface)
    }

    /// The frame `is` picks, taken: its buffer was destroyed.
    pub fn take_where(&mut self, is: impl Fn(&F) -> bool) -> Option<(SurfaceId, F)> {
        let surface = *self.frames.iter().find(|(_, frame)| is(frame))?.0;
        self.frames.remove(&surface).map(|frame| (surface, frame))
    }

    /// Every frame, taken: the engine the surfaces belonged to is gone.
    pub fn take_all(&mut self) -> Vec<(SurfaceId, F)> {
        self.frames.drain().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SURFACE: SurfaceId = 1;

    /// A frame, as far as this module can tell one from another.
    fn frame(buffer: u32) -> u32 {
        buffer
    }

    #[test]
    fn a_frame_waits_for_its_surface_and_goes_up_once() {
        let mut waiting = Waiting::default();

        assert_eq!(waiting.wait(SURFACE, frame(1)), None);

        assert_eq!(waiting.take(SURFACE + 1), None, "another surface has none");
        assert_eq!(waiting.take(SURFACE), Some(frame(1)));
        assert_eq!(waiting.take(SURFACE), None, "and it is gone once taken");
    }

    #[test]
    fn a_newer_frame_hands_the_older_back() {
        let mut waiting = Waiting::default();
        waiting.wait(SURFACE, frame(1));

        assert_eq!(waiting.wait(SURFACE, frame(2)), Some(frame(1)));
        assert_eq!(waiting.take(SURFACE), Some(frame(2)));
    }

    #[test]
    fn a_destroyed_buffer_stops_waiting_and_a_dead_engine_takes_them_all() {
        let mut waiting = Waiting::default();
        waiting.wait(SURFACE, frame(1));
        waiting.wait(SURFACE + 1, frame(2));

        assert_eq!(
            waiting.take_where(|buffer| *buffer == 2),
            Some((SURFACE + 1, frame(2)))
        );
        assert_eq!(waiting.take_where(|buffer| *buffer == 2), None);
        assert_eq!(waiting.take_all(), vec![(SURFACE, frame(1))]);
        assert_eq!(waiting.take(SURFACE), None);
    }
}
