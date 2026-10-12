//! Tracks the surface the engine brokered for each app and which of them a
//! page has embedded.
//!
//! The engine drops frames submitted before a page's `<app>` element embeds
//! the frame sink, since there is no `LocalSurfaceId` yet. The C ABI's submit
//! returns `void`, so the compositor tracks embeds itself. Holding a buffer for
//! a dropped frame would leave the client waiting for a release that never
//! comes, until [`crate::engine_buffers::HeldBuffers::expired`] takes it back.
//!
//! Waiting for the embed cannot deadlock: the page embeds once the frame sink
//! exists, not once a frame arrives.
//!
//! It also numbers each surface's frames as the engine does, from 1 per
//! submit, so `Event::FrameDone` and `Event::Presented` name the commit they
//! answer. See `crate::frame_callbacks`.

use std::collections::{HashMap, HashSet};

use crate::engine::SurfaceId;

/// The engine's surfaces, by the app each one is a window of.
#[derive(Debug, Default)]
pub struct Surfaces {
    by_app: HashMap<String, SurfaceId>,
    embedded: HashSet<SurfaceId>,
    /// The number of the last frame submitted for each surface.
    frames: HashMap<SurfaceId, u64>,
}

impl Surfaces {
    /// The surface brokered for `app_id`, if one has been.
    pub fn get(&self, app_id: &str) -> Option<SurfaceId> {
        self.by_app.get(app_id).copied()
    }

    /// The browser brokered `surface` as `app_id`'s window.
    pub fn brokered(&mut self, app_id: &str, surface: SurfaceId) {
        self.by_app.insert(app_id.to_owned(), surface);
    }

    /// Records that a page embedded `surface` (`Event::Configure`, from the
    /// engine's `OnSurfaceEmbedded`).
    pub fn embedded(&mut self, surface: SurfaceId) {
        self.embedded.insert(surface);
    }

    /// Whether a frame submitted for `surface` reaches viz instead of being
    /// dropped.
    pub fn takes_frames(&self, surface: SurfaceId) -> bool {
        self.embedded.contains(&surface)
    }

    /// A frame was submitted for `surface`: its number.
    pub fn submitted(&mut self, surface: SurfaceId) -> u64 {
        let frame = self.frames.entry(surface).or_default();
        *frame += 1;
        *frame
    }

    /// The number of the last frame submitted for `app_id`'s surface.
    pub fn last_frame(&self, app_id: &str) -> Option<u64> {
        self.frames.get(&self.get(app_id)?).copied()
    }

    /// Which app `surface` belongs to. A linear scan, since there are only a
    /// few windows.
    pub fn app_for(&self, surface: SurfaceId) -> Option<&str> {
        self.by_app
            .iter()
            .find(|(_, brokered)| **brokered == surface)
            .map(|(app_id, _)| app_id.as_str())
    }

    /// Removes every surface after the engine is lost.
    ///
    /// Embeds are cleared too: a re-brokered surface takes no frames until the
    /// page embeds it again.
    pub fn drain(&mut self) -> std::collections::hash_map::Drain<'_, String, SurfaceId> {
        self.embedded.clear();
        self.frames.clear();
        self.by_app.drain()
    }

    /// Removes the surface of a closed window.
    pub fn forget(&mut self, app_id: &str) -> Option<SurfaceId> {
        let surface = self.by_app.remove(app_id)?;
        self.embedded.remove(&surface);
        self.frames.remove(&surface);
        Some(surface)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = "app-1";
    const SURFACE: SurfaceId = 1;

    #[test]
    fn a_brokered_surface_is_found_by_its_app_and_its_app_by_it() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);

        assert_eq!(surfaces.get(APP), Some(SURFACE));
        assert_eq!(surfaces.app_for(SURFACE), Some(APP));
        assert_eq!(surfaces.get("app-2"), None);
        assert_eq!(surfaces.app_for(SURFACE + 1), None);
    }

    // The engine drops frames between brokering a sink and the page's embed.
    #[test]
    fn a_surface_no_page_has_embedded_takes_no_frames() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);

        assert!(
            !surfaces.takes_frames(SURFACE),
            "a brokered sink with nowhere to draw drops what it is given, and a \
             buffer held for a dropped frame is owed a release nothing can send"
        );
    }

    #[test]
    fn a_page_embedding_a_surface_is_what_makes_it_take_frames() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);
        surfaces.embedded(SURFACE);

        assert!(surfaces.takes_frames(SURFACE));
        assert!(
            !surfaces.takes_frames(SURFACE + 1),
            "and only the surface that was embedded"
        );
    }

    // A reopened window gets a new sink, which no page has embedded yet.
    #[test]
    fn a_window_that_comes_back_waits_to_be_embedded_again() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);
        surfaces.embedded(SURFACE);
        surfaces.forget(APP);

        surfaces.brokered(APP, SURFACE);
        assert!(!surfaces.takes_frames(SURFACE));
    }

    #[test]
    fn a_window_that_went_away_leaves_its_surface_to_nobody() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);

        assert_eq!(surfaces.forget(APP), Some(SURFACE));
        assert_eq!(surfaces.get(APP), None);
        assert_eq!(surfaces.forget(APP), None);
    }

    // The engine numbers every submit, so the compositor must too.
    #[test]
    fn each_surface_numbers_its_frames_from_one() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);
        surfaces.brokered("app-2", SURFACE + 1);
        assert_eq!(surfaces.last_frame(APP), None);

        assert_eq!(surfaces.submitted(SURFACE), 1);
        assert_eq!(surfaces.submitted(SURFACE), 2);
        assert_eq!(surfaces.submitted(SURFACE + 1), 1);
        assert_eq!(surfaces.last_frame(APP), Some(2));
        assert_eq!(surfaces.last_frame("app-3"), None);
    }

    // A new surface, from a reopened window or a new engine, starts again.
    #[test]
    fn a_surface_brokered_again_numbers_its_frames_afresh() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);
        surfaces.submitted(SURFACE);
        surfaces.forget(APP);
        surfaces.brokered(APP, SURFACE);
        assert_eq!(surfaces.submitted(SURFACE), 1);

        surfaces.drain();
        surfaces.brokered(APP, SURFACE);
        assert_eq!(surfaces.submitted(SURFACE), 1);
    }

    // A new engine can reuse the old surface ids, so a re-brokered surface
    // must still wait for its embed.
    #[test]
    fn a_reconnect_takes_the_embeds_with_the_surfaces() {
        let mut surfaces = Surfaces::default();
        surfaces.brokered(APP, SURFACE);
        surfaces.embedded(SURFACE);

        assert_eq!(
            surfaces.drain().collect::<Vec<_>>(),
            vec![(APP.to_owned(), SURFACE)]
        );

        surfaces.brokered(APP, SURFACE);
        assert!(!surfaces.takes_frames(SURFACE));
    }
}
