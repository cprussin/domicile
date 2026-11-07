//! Closed windows' surfaces, kept on screen while the shell animates them out.
//!
//! The shell keeps drawing a closed window's `<app>` element through its close
//! animation. Destroying the surface, or forgetting the imports its last frame
//! shows, at once would blank that element first, so only the window's frame
//! would animate. Each closed surface instead lingers for [`LINGER`], longer
//! than any close animation, and is destroyed after.
//!
//! The window is gone from everything else at once: the chromes hear
//! `app_closed`, and its app id names nothing, so a returning client gets a
//! new surface.

use std::collections::HashMap;
use std::time::Duration;

use crate::engine::{BufferId, SurfaceId};

/// How long a closed window's surface outlives it.
pub const LINGER: Duration = Duration::from_secs(1);

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

    /// Ends `linger`, returning the imports to forget. `None` if it already
    /// ended, as [`Lingering::clear`] ends them all.
    pub fn over(&mut self, linger: Linger) -> Option<Vec<BufferId>> {
        match self.surfaces.get(&linger.surface) {
            Some((token, _)) if *token == linger.token => self
                .surfaces
                .remove(&linger.surface)
                .map(|(_, imports)| imports),
            _ => None,
        }
    }

    /// Forgets every linger, for a lost engine: it took the surfaces with it.
    pub fn clear(&mut self) {
        self.surfaces.clear();
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
}
