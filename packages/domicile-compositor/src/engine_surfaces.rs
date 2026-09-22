//! Which surface the engine brokered for each app's window, and which of those
//! a page has embedded.
//!
//! The second half is the one with teeth, because it decides whether a submit
//! reaches viz at all. `domicile_surface_create` brokers a frame sink the first
//! time an app commits, and from then on the engine accepts
//! `domicile_surface_submit` for it — but the engine's own `Surface::Submit`
//! drops the frame and returns false until a page's `<app>` element has
//! embedded that sink, because until then there is no `LocalSurfaceId` to
//! submit to. The C ABI does not carry that answer back: the entry point is
//! `void`. So this side has to know the rule rather than be told the outcome.
//!
//! Getting it wrong is not a dropped frame, it is a stopped client. A buffer
//! held for a frame the engine dropped is owed a `wl_buffer.release` that
//! cannot ever arrive — viz was never given the resource, so nothing will ever
//! return it. It sits until [`crate::engine_buffers::HeldBuffers::expired`]
//! takes it back half a second later and reports viz for holding a dmabuf it
//! has finished with, which viz never had.
//!
//! Measured, on `Engine` run 35681982140: every compositor log in that job
//! shows "the engine took this app's first frame" 79-394 ms before the first
//! `engine configure -> client`, which is the only thing `OnSurfaceEmbedded`
//! writes. The two-windows negative control submitted three frames inside that
//! window and reported exactly three of those errors, each 500 ms after its own
//! submit.
//!
//! Declining to submit before the embed deadlocks nothing: the page embeds when
//! the browser tells it the app has a producer, and the producer is the frame
//! sink, not a frame.

use std::collections::{HashMap, HashSet};

use crate::engine::SurfaceId;

/// The engine's surfaces, by the app each one is a window of.
#[derive(Debug, Default)]
pub struct Surfaces {
    by_app: HashMap<String, SurfaceId>,
    embedded: HashSet<SurfaceId>,
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

    /// A page embedded `surface`, so the engine has somewhere to put a frame
    /// for it. This is the compositor's `Event::Configure`, and the engine's
    /// `OnSurfaceEmbedded`.
    pub fn embedded(&mut self, surface: SurfaceId) {
        self.embedded.insert(surface);
    }

    /// Whether a frame submitted for `surface` reaches viz, rather than being
    /// dropped by an engine with nowhere to put it. See this module's head:
    /// holding a buffer for a frame that was dropped strands it for ever.
    pub fn takes_frames(&self, surface: SurfaceId) -> bool {
        self.embedded.contains(&surface)
    }

    /// Which app `surface` belongs to, for an event that names only the
    /// surface. One engine holds a handful of windows, so a scan beats keeping
    /// a second map honest.
    pub fn app_for(&self, surface: SurfaceId) -> Option<&str> {
        self.by_app
            .iter()
            .find(|(_, brokered)| **brokered == surface)
            .map(|(app_id, _)| app_id.as_str())
    }

    /// Takes every surface out, because the engine that minted them is gone.
    ///
    /// The embeds go with them, and that is the point rather than tidiness: a
    /// `SurfaceId` from the dead engine names nothing in the new one, and a
    /// page re-embeds when the new engine re-brokers. Until it does, a frame
    /// submitted for the re-brokered surface is one the engine would drop, so
    /// `takes_frames` must say no about it -- which is this module's whole
    /// subject, arrived at from the other direction.
    pub fn drain(&mut self) -> std::collections::hash_map::Drain<'_, String, SurfaceId> {
        self.embedded.clear();
        self.by_app.drain()
    }

    /// The app's window went away, so its surface is nobody's.
    pub fn forget(&mut self, app_id: &str) -> Option<SurfaceId> {
        let surface = self.by_app.remove(app_id)?;
        self.embedded.remove(&surface);
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

    // THE FRAME SINK IS NOT THE SURFACE, and half a second of a stopped client
    // is the difference. `create_surface` returns the moment the browser mints
    // a `FrameSinkId`, which is before any page has embedded it, and the engine
    // drops every frame submitted in that window because it has no
    // `LocalSurfaceId` to put one on. Held anyway, those buffers are owed a
    // release from a viz that was never handed them.
    //
    // Measured on `Engine` run 35681982140: the two-windows negative control
    // brokered its sink at 50.782 and was embedded at 51.179, submitted three
    // frames in between, and reported exactly three "the engine never released
    // a client buffer" errors -- at 51.249, 51.495 and 51.527, each 500 ms
    // after its own submit.
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

    // A second window for the same app starts where the first one did. The
    // engine mints a new sink for it, which no page has embedded yet.
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

    // A reconnect re-brokers every app that had a window, and the id it gets
    // back can be the one the dead engine used -- both counters start at zero.
    // So a drained surface that is handed the same number must still be
    // waiting on its page, or the first frame after a reconnect is held for a
    // submit the new engine drops.
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
