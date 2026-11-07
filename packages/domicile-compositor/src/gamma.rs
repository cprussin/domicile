//! Each monitor's gamma ramp, and who owns it.
//!
//! The night light sets a white point, for every monitor or for one. A
//! `wlr-gamma-control` client (gammastep, wl-gammarelay-rs) sets a whole ramp
//! for one monitor. One rule decides between them:
//!
//! - A client holding a monitor owns its ramp outright. The night light does
//!   not apply there, so the two never multiply.
//! - Every monitor no client holds draws with its night light.
//! - When the client lets go, its monitor goes back to its night light.
//!
//! One client holds a monitor at a time. A monitor with no gamma (a DisplayLink
//! dock, a nested or headless desktop) can be held by none.
//!
//! See `docs/DISPLAYS.md#night-light-and-gamma-control`.

use std::collections::HashMap;

use domicile_host::white_point::{white_point, WhitePoint, NEUTRAL};

/// Every monitor's night light and gamma-control client.
///
/// `H` names a client's hold: its `zwlr_gamma_control_v1`, or a number in the
/// tests.
pub struct Ramps<H> {
    /// The night light of every monitor not in `by_output`.
    every: WhitePoint,
    /// Night lights the shell set for one monitor, by `wl_output` name.
    by_output: HashMap<String, WhitePoint>,
    /// How many entries each engine display's ramp has. A display it leaves
    /// out has no gamma.
    sizes: HashMap<i64, u32>,
    /// The client holding each engine display, and the ramp it last set.
    held: HashMap<i64, Held<H>>,
}

struct Held<H> {
    holder: H,
    /// `None` until the client sets one; until then the night light draws.
    ramp: Option<Vec<u16>>,
}

/// Why a client cannot hold a monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// The monitor has no gamma, or is not one of the engine's displays.
    NoGamma,
    /// Another client holds it.
    Held,
}

/// A ramp a client set that is not three channels of the monitor's size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WrongLength {
    pub expected: usize,
}

impl<H: PartialEq> Default for Ramps<H> {
    fn default() -> Self {
        Ramps {
            every: white_point(NEUTRAL),
            by_output: HashMap::new(),
            sizes: HashMap::new(),
            held: HashMap::new(),
        }
    }
}

impl<H: PartialEq> Ramps<H> {
    /// Sets the night light of `output`, or of every monitor when `None`.
    /// Every monitor's replaces each one's, as the shell's switch for the
    /// whole desk.
    pub fn set_white_point(&mut self, output: Option<&str>, white: WhitePoint) {
        match output {
            Some(output) => {
                self.by_output.insert(output.to_owned(), white);
            }
            None => {
                self.every = white;
                self.by_output.clear();
            }
        }
    }

    /// Takes the engine's ramp sizes. Returns the holds on displays that have
    /// lost their gamma, as by an unplug, which are let go.
    pub fn set_sizes(&mut self, sizes: HashMap<i64, u32>) -> Vec<H> {
        self.sizes = sizes;
        let lost: Vec<i64> = self
            .held
            .keys()
            .filter(|display| !self.sizes.contains_key(display))
            .copied()
            .collect();
        lost.into_iter()
            .filter_map(|display| self.held.remove(&display))
            .map(|held| held.holder)
            .collect()
    }

    /// Gives `display` to `holder`. Returns its ramp size.
    pub fn hold(&mut self, display: Option<i64>, holder: H) -> Result<u32, Refused> {
        let (display, size) = display
            .and_then(|display| Some((display, *self.sizes.get(&display)?)))
            .ok_or(Refused::NoGamma)?;
        if self.held.contains_key(&display) {
            return Err(Refused::Held);
        }
        self.held.insert(display, Held { holder, ramp: None });
        Ok(size)
    }

    /// Sets the ramp of the display `holder` holds. Returns the display, or
    /// `None` for a holder that holds none: one that was refused or let go.
    pub fn set(&mut self, holder: &H, ramp: Vec<u16>) -> Result<Option<i64>, WrongLength> {
        let Some((&display, held)) = self
            .held
            .iter_mut()
            .find(|(_, held)| held.holder == *holder)
        else {
            return Ok(None);
        };
        let expected = 3 * self.sizes[&display] as usize;
        if ramp.len() != expected {
            return Err(WrongLength { expected });
        }
        held.ramp = Some(ramp);
        Ok(Some(display))
    }

    /// Lets go of the display `holder` holds. Returns it, or `None` if it held
    /// none.
    pub fn release(&mut self, holder: &H) -> Option<i64> {
        let display = self
            .held
            .iter()
            .find(|(_, held)| held.holder == *holder)
            .map(|(&display, _)| display)?;
        self.held.remove(&display);
        Some(display)
    }

    /// How many entries `display`'s ramp has, or `None` if it has no gamma.
    pub fn size(&self, display: i64) -> Option<u32> {
        self.sizes.get(&display).copied()
    }

    /// The ramp `display`, shown as `output`, draws with: its client's, or its
    /// night light's. `None` if it has no gamma.
    pub fn ramp(&self, display: i64, output: Option<&str>) -> Option<Vec<u16>> {
        let size = self.size(display)?;
        if let Some(ramp) = self.held.get(&display).and_then(|held| held.ramp.clone()) {
            return Some(ramp);
        }
        let white = output
            .and_then(|output| self.by_output.get(output))
            .copied()
            .unwrap_or(self.every);
        Some(ramp_of(white, size))
    }
}

/// A ramp of `size` entries per channel that draws white as `white`: a
/// straight line from black, scaled per channel. Red, then green, then blue.
pub fn ramp_of(white: WhitePoint, size: u32) -> Vec<u16> {
    let channel = |gain: f64| {
        (0..size).map(move |index| {
            let level = match size {
                1 => 1.0,
                _ => f64::from(index) / f64::from(size - 1),
            };
            (level * gain * f64::from(u16::MAX)).round() as u16
        })
    };
    channel(white.red)
        .chain(channel(white.green))
        .chain(channel(white.blue))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const WARM: WhitePoint = WhitePoint {
        red: 1.0,
        green: 0.5,
        blue: 0.25,
    };

    fn with_sizes(sizes: &[(i64, u32)]) -> Ramps<u32> {
        let mut ramps = Ramps::default();
        ramps.set_sizes(sizes.iter().copied().collect());
        ramps
    }

    #[test]
    fn a_ramp_runs_from_black_to_the_white_point() {
        assert_eq!(
            ramp_of(WARM, 3),
            vec![0, 32768, 65535, 0, 16384, 32768, 0, 8192, 16384]
        );
    }

    #[test]
    fn neutral_is_an_identity_ramp() {
        assert_eq!(
            ramp_of(white_point(NEUTRAL), 2),
            vec![0, 65535, 0, 65535, 0, 65535]
        );
    }

    #[test]
    fn a_one_entry_ramp_is_white() {
        assert_eq!(ramp_of(WARM, 1), vec![65535, 32768, 16384]);
    }

    #[test]
    fn a_display_with_no_gamma_has_no_ramp() {
        let ramps = with_sizes(&[(7, 2)]);

        assert_eq!(ramps.ramp(9, Some("DP-1")), None);
    }

    #[test]
    fn one_monitors_night_light_leaves_the_others_alone() {
        let mut ramps = with_sizes(&[(7, 2), (9, 2)]);

        ramps.set_white_point(Some("eDP-2"), WARM);

        assert_eq!(
            ramps.ramp(7, Some("eDP-1")),
            Some(ramp_of(white_point(NEUTRAL), 2))
        );
        assert_eq!(ramps.ramp(9, Some("eDP-2")), Some(ramp_of(WARM, 2)));
    }

    #[test]
    fn every_monitors_night_light_replaces_each_ones() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.set_white_point(Some("eDP-1"), WARM);

        ramps.set_white_point(None, white_point(3400));

        assert_eq!(
            ramps.ramp(7, Some("eDP-1")),
            Some(ramp_of(white_point(3400), 2))
        );
    }

    #[test]
    fn a_client_is_told_the_monitors_ramp_size() {
        let mut ramps = with_sizes(&[(7, 4096)]);

        assert_eq!(ramps.hold(Some(7), 1), Ok(4096));
    }

    #[test]
    fn a_monitor_with_no_gamma_refuses_a_client() {
        let mut ramps = with_sizes(&[(7, 2)]);

        assert_eq!(ramps.hold(Some(9), 1), Err(Refused::NoGamma));
        assert_eq!(ramps.hold(None, 1), Err(Refused::NoGamma));
    }

    #[test]
    fn a_second_client_is_refused_a_held_monitor() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.hold(Some(7), 1).unwrap();

        assert_eq!(ramps.hold(Some(7), 2), Err(Refused::Held));
    }

    #[test]
    fn a_clients_ramp_replaces_the_night_light_rather_than_warming_it() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.set_white_point(None, WARM);
        ramps.hold(Some(7), 1).unwrap();

        assert_eq!(ramps.set(&1, vec![1, 2, 3, 4, 5, 6]), Ok(Some(7)));

        assert_eq!(ramps.ramp(7, Some("eDP-1")), Some(vec![1, 2, 3, 4, 5, 6]));
    }

    #[test]
    fn a_held_monitor_keeps_its_night_light_until_the_client_sets_a_ramp() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.set_white_point(None, WARM);

        ramps.hold(Some(7), 1).unwrap();

        assert_eq!(ramps.ramp(7, None), Some(ramp_of(WARM, 2)));
    }

    #[test]
    fn a_ramp_of_the_wrong_length_is_refused() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.hold(Some(7), 1).unwrap();

        assert_eq!(ramps.set(&1, vec![0; 5]), Err(WrongLength { expected: 6 }));
    }

    #[test]
    fn a_refused_client_sets_nothing() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.hold(Some(7), 1).unwrap();
        let _ = ramps.hold(Some(7), 2);

        assert_eq!(ramps.set(&2, vec![0; 6]), Ok(None));
        assert_eq!(ramps.ramp(7, None), Some(ramp_of(white_point(NEUTRAL), 2)));
    }

    #[test]
    fn a_released_monitor_goes_back_to_its_night_light() {
        let mut ramps = with_sizes(&[(7, 2)]);
        ramps.set_white_point(Some("eDP-1"), WARM);
        ramps.hold(Some(7), 1).unwrap();
        ramps.set(&1, vec![0; 6]).unwrap();

        assert_eq!(ramps.release(&1), Some(7));

        assert_eq!(ramps.ramp(7, Some("eDP-1")), Some(ramp_of(WARM, 2)));
        assert_eq!(ramps.hold(Some(7), 2), Ok(2), "free for the next client");
    }

    #[test]
    fn an_unplugged_monitors_client_is_let_go() {
        let mut ramps = with_sizes(&[(7, 2), (9, 2)]);
        ramps.hold(Some(7), 1).unwrap();
        ramps.hold(Some(9), 2).unwrap();

        let lost = ramps.set_sizes(HashMap::from([(9, 2)]));

        assert_eq!(lost, vec![1]);
        assert_eq!(ramps.release(&1), None);
        assert_eq!(ramps.release(&2), Some(9));
    }
}
