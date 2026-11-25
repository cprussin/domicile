//! Closed windows' surfaces, kept on screen while the shell animates them out.
//!
//! The shell keeps drawing a closed window's `<app>` element through its close
//! animation, and may keep the element in the page longer, as a gallery of
//! closed windows does. Destroying the surface, or forgetting the imports its
//! last frame shows, at once would blank that element first, so only the
//! window's frame would animate. Each closed surface instead lingers while an
//! `<app>` element shows it, for at most [`LINGER`], and is destroyed after.
//! The engine says when the last element showing a surface leaves the page
//! ([`Lingering::showing`]); a surface no element showed when it closed goes
//! at once.
//!
//! The window is gone from everything else at once: the chromes hear
//! `app_closed`, and its app id names nothing, so a returning client gets a
//! new surface.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use crate::engine::{BufferId, SurfaceId};

/// The longest a closed window's surface outlives it.
pub const LINGER: Duration = Duration::from_secs(10);

/// One closed surface's linger, to end with [`Lingering::over`].
///
/// The token tells it from a later linger of the same id: a restarted engine
/// numbers its surfaces afresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Linger {
    pub surface: SurfaceId,
    token: u64,
}

/// The surfaces lingering, each with the imports to forget when it goes.
#[derive(Debug, Default)]
pub struct Lingering {
    surfaces: HashMap<SurfaceId, (u64, Vec<BufferId>)>,
    /// Surfaces no `<app>` element shows since one did.
    hidden: HashSet<SurfaceId>,
    next: u64,
}

impl Lingering {
    /// Starts `surface`'s linger, holding `imports` until it ends.
    pub fn start(&mut self, surface: SurfaceId, imports: Vec<BufferId>) -> Linger {
        self.next += 1;
        self.surfaces.insert(surface, (self.next, imports));
        Linger {
            surface,
            token: self.next,
        }
    }

    /// How long `surface` may linger: [`LINGER`] while an `<app>` element
    /// shows it, and no time once none does.
    pub fn lasts(&self, surface: SurfaceId) -> Duration {
        if self.hidden.contains(&surface) {
            Duration::ZERO
        } else {
            LINGER
        }
    }

    /// Records whether an `<app>` element shows `surface`, as the engine
    /// says. Returns its linger to end now when it lingers and none does.
    pub fn showing(&mut self, surface: SurfaceId, showing: bool) -> Option<Linger> {
        if showing {
            self.hidden.remove(&surface);
            return None;
        }
        self.hidden.insert(surface);
        self.surfaces.get(&surface).map(|(token, _)| Linger {
            surface,
            token: *token,
        })
    }

    /// Ends `linger`, returning the imports to forget. `None` if it already
    /// ended, as [`Lingering::clear`] ends them all.
    pub fn over(&mut self, linger: Linger) -> Option<Vec<BufferId>> {
        match self.surfaces.get(&linger.surface) {
            Some((token, _)) if *token == linger.token => {
                // The engine destroys the surface, so its id may name a new
                // one, which starts out shown.
                self.hidden.remove(&linger.surface);
                self.surfaces
                    .remove(&linger.surface)
                    .map(|(_, imports)| imports)
            }
            _ => None,
        }
    }

    /// Forgets every linger, for a lost engine: it took the surfaces with it.
    pub fn clear(&mut self) {
        self.surfaces.clear();
        self.hidden.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_linger_ends_once_with_its_imports() {
        let mut lingering = Lingering::default();
        let linger = lingering.start(1, vec![4, 5]);

        assert_eq!(lingering.over(linger), Some(vec![4, 5]));
        assert_eq!(lingering.over(linger), None);
    }

    #[test]
    fn a_cleared_linger_ends_nothing() {
        let mut lingering = Lingering::default();
        let linger = lingering.start(1, vec![4]);
        lingering.clear();

        assert_eq!(lingering.over(linger), None);
    }

    // A restarted engine reuses surface ids. The old engine's timer must not
    // end the new surface's linger early.
    #[test]
    fn an_old_linger_does_not_end_a_new_one_of_the_same_id() {
        let mut lingering = Lingering::default();
        let old = lingering.start(1, vec![4]);
        lingering.clear();
        let new = lingering.start(1, vec![7]);

        assert_eq!(lingering.over(old), None);
        assert_eq!(lingering.over(new), Some(vec![7]));
    }

    #[test]
    fn a_shown_surface_lingers_its_full_time() {
        let mut lingering = Lingering::default();
        lingering.showing(1, true);
        lingering.start(1, vec![4]);

        assert_eq!(lingering.lasts(1), LINGER);
    }

    #[test]
    fn a_surface_no_element_shows_goes_at_once() {
        let mut lingering = Lingering::default();
        lingering.showing(1, false);
        lingering.start(1, vec![4]);

        assert_eq!(lingering.lasts(1), Duration::ZERO);
    }

    #[test]
    fn a_linger_ends_once_its_element_leaves_the_page() {
        let mut lingering = Lingering::default();
        let linger = lingering.start(1, vec![4]);

        assert_eq!(lingering.showing(1, false), Some(linger));
        assert_eq!(lingering.over(linger), Some(vec![4]));
    }

    #[test]
    fn hiding_a_surface_that_is_not_lingering_ends_nothing() {
        let mut lingering = Lingering::default();

        assert_eq!(lingering.showing(1, false), None);
        assert_eq!(lingering.showing(1, true), None);
        assert_eq!(lingering.lasts(1), LINGER);
    }

    // A restarted engine reuses the id for a surface it shows afresh.
    #[test]
    fn a_destroyed_surfaces_id_starts_out_shown() {
        let mut lingering = Lingering::default();
        let linger = lingering.start(1, vec![4]);
        lingering.showing(1, false);
        lingering.over(linger);

        assert_eq!(lingering.lasts(1), LINGER);
    }
}
