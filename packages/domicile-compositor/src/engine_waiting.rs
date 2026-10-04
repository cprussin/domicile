//! Holds the last frame each surface committed before a page embedded it.
//!
//! The engine drops frames for unembedded surfaces (see `engine_surfaces`). A
//! window recovers because the embed resizes it and the client redraws. A
//! popup is not resized, and a menu draws once, so without this its first
//! frame is lost and it stays blank until hovered.
//!
//! Only the newest frame per surface is kept; the caller releases older ones.

use std::collections::HashMap;

use crate::engine::SurfaceId;

/// Frames waiting for an embed, by surface. The session defines `F`.
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
    /// Keeps `frame` until `surface` is embedded. Returns the replaced frame,
    /// whose buffer the caller releases.
    pub fn wait(&mut self, surface: SurfaceId, frame: F) -> Option<F> {
        self.frames.insert(surface, frame)
    }

    /// Removes the frame waiting for `surface`.
    pub fn take(&mut self, surface: SurfaceId) -> Option<F> {
        self.frames.remove(&surface)
    }

    /// Removes the frame `is` matches, for a destroyed buffer.
    pub fn take_where(&mut self, is: impl Fn(&F) -> bool) -> Option<(SurfaceId, F)> {
        let surface = *self.frames.iter().find(|(_, frame)| is(frame))?.0;
        self.frames.remove(&surface).map(|frame| (surface, frame))
    }

    /// Removes every frame, for a lost engine.
    pub fn take_all(&mut self) -> Vec<(SurfaceId, F)> {
        self.frames.drain().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SURFACE: SurfaceId = 1;

    /// A stand-in frame identified by its buffer.
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
