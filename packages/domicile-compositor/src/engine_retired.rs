//! Imports whose `wl_buffer` the client destroyed while it was on screen.
//!
//! Forgetting an import makes the browser drop its shared image, and viz then
//! draws nothing where the window's last frame was. A client may destroy the
//! buffer on screen before it closes the window: GLFW clients such as kitty
//! destroy their EGL surface, and with it every buffer, before the toplevel.
//! The window's `<app>` would then be blank for its whole close animation.
//!
//! Such an import is retired instead of forgotten. It is forgotten once viz
//! releases it, when a newer frame replaces it, or with the window's surface
//! once that has lingered (see `engine_lingering`).

use std::collections::HashMap;

use crate::engine::{BufferId, SurfaceId};

/// The retired imports, by surface.
#[derive(Debug, Default)]
pub struct Retired {
    surfaces: HashMap<SurfaceId, Vec<BufferId>>,
}

impl Retired {
    /// Retires `id`, the frame on screen for `surface`.
    pub fn retire(&mut self, surface: SurfaceId, id: BufferId) {
        let ids = self.surfaces.entry(surface).or_default();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    /// Takes `id` out once viz no longer holds it. Whether it was retired, so
    /// the caller forgets the import.
    pub fn take(&mut self, surface: SurfaceId, id: BufferId) -> bool {
        let Some(ids) = self.surfaces.get_mut(&surface) else {
            return false;
        };
        let Some(at) = ids.iter().position(|retired| *retired == id) else {
            return false;
        };
        ids.swap_remove(at);
        if ids.is_empty() {
            self.surfaces.remove(&surface);
        }
        true
    }

    /// Takes every import retired on `surface`, for a window that went: they
    /// linger with its surface.
    pub fn surface_gone(&mut self, surface: SurfaceId) -> Vec<BufferId> {
        self.surfaces.remove(&surface).unwrap_or_default()
    }

    /// Takes every retired import, for a lost engine that took them with it.
    pub fn drain(&mut self) -> Vec<(SurfaceId, BufferId)> {
        self.surfaces
            .drain()
            .flat_map(|(surface, ids)| ids.into_iter().map(move |id| (surface, id)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_retired_import_is_taken_once() {
        let mut retired = Retired::default();
        retired.retire(1, 4);

        assert!(retired.take(1, 4));
        assert!(!retired.take(1, 4));
    }

    // Buffer ids count per surface, so another surface's id 4 is another
    // import.
    #[test]
    fn an_import_is_retired_on_its_own_surface() {
        let mut retired = Retired::default();
        retired.retire(1, 4);

        assert!(!retired.take(2, 4));
        assert!(retired.take(1, 4));
    }

    #[test]
    fn a_gone_surface_takes_its_retired_imports() {
        let mut retired = Retired::default();
        retired.retire(1, 4);
        retired.retire(1, 5);
        retired.retire(2, 4);

        let mut gone = retired.surface_gone(1);
        gone.sort_unstable();
        assert_eq!(gone, vec![4, 5]);
        assert!(!retired.take(1, 4));
        assert!(retired.take(2, 4));
    }

    #[test]
    fn a_lost_engine_takes_them_all() {
        let mut retired = Retired::default();
        retired.retire(1, 4);
        retired.retire(2, 5);

        let mut all = retired.drain();
        all.sort_unstable();
        assert_eq!(all, vec![(1, 4), (2, 5)]);
        assert!(retired.surface_gone(1).is_empty());
    }
}
