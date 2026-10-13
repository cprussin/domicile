//! Temporary spike probes: pixels and colors read back from what viz drew, and
//! logged for shell guards to check.

use std::time::{Duration, Instant};

use tracing::{debug, warn};

use crate::engine::{Bounds, Capture};
use crate::latency_run::spike_latency_point;
use crate::DomicileCompositor;

impl DomicileCompositor {
    /// Run after the engine takes a frame: log the first frame, and run the
    /// spike probes.
    pub fn frame_shown(&mut self, app_id: &str) {
        if self.first_frame_logged.first(app_id) {
            debug!(app_id, "the engine took this app's first frame");
        }
        // Temporary spike probes. Only the compositor can ask viz what it drew.
        // Results are logged because shell scripts check them.
        //
        // Throttled, and checked before borrowing the session.
        const PROBE_EVERY: Duration = Duration::from_millis(250);
        // `match` rather than `is_none_or`, which is newer than this crate's
        // MSRV, or `map_or(true, ..)`, which clippy rewrites into it.
        let due = match self.last_probe {
            None => true,
            Some(at) => at.elapsed() >= PROBE_EVERY,
        };
        if !due {
            return;
        }
        self.last_probe = Some(Instant::now());
        let Some(session) = self.engine.as_ref() else {
            return;
        };
        // Find colors anywhere in the window, for guards that cannot name a
        // point because the shell places windows.
        //
        // Search until every color is found and no box moved between two
        // rounds. A window still painting is smaller than it will be, and the
        // guard measures coverage.
        //
        // Then stop. Each search is a ~3 MB blocking readback, longer than
        // `HeldBuffers`' 500ms deadline, so searching forever would expire
        // held buffers.
        const FIND_EVERY: Duration = Duration::from_secs(2);
        // Wall-clock budget, since guards start polling after an unpredictable
        // setup. Longer than any guard's run.
        const FIND_FOR: Duration = Duration::from_secs(300);
        let find_due = match self.last_find {
            None => true,
            Some(at) => at.elapsed() >= FIND_EVERY,
        };
        if find_due && !spike_find_colors().is_empty() && !self.find_settled {
            // Starts at the first search, which is the first engine-accepted
            // client frame. Waiting for a client does not spend the budget.
            let since = *self.find_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= FIND_FOR {
                // Logged once, so a guard can tell "not found" from "stopped
                // looking".
                self.find_settled = true;
                warn!(
                    target: "domicile::engine::spike",
                    seconds = FIND_FOR.as_secs(),
                    "giving up looking for the colors that have not turned up; a whole-window \
                     readback is time this thread is not releasing the client's buffers, and it \
                     is not worth paying for a color that was going to appear long ago"
                );
            } else {
                let mut every_color_found = true;
                let mut nothing_moved = true;
                for &argb in spike_find_colors() {
                    match session.spike_find(argb) {
                        Some(Capture {
                            window: (w, h),
                            bounds: Some(bounds),
                        }) => {
                            // Logged when it changes, so a still-painting page
                            // logs each move.
                            if self.probe_boxes.insert(argb, bounds) != Some(bounds) {
                                nothing_moved = false;
                                let Bounds {
                                    height,
                                    width,
                                    x,
                                    y,
                                } = bounds;
                                tracing::info!(
                                    target: "domicile::engine::spike",
                                    "engine found #{argb:08X} over ({x},{y}) {width}x{height} \
                                     of the browser's {w}x{h} window"
                                );
                            }
                        }
                        // Logged once; this is the usual state for most of a
                        // run.
                        Some(Capture {
                            window: (w, h),
                            bounds: None,
                        }) => {
                            every_color_found = false;
                            // Forget the box, so found-absent-found cannot
                            // settle against a reading two rounds old.
                            self.probe_boxes.remove(&argb);
                            if self.probe_missing.insert(argb) {
                                tracing::info!(
                                    target: "domicile::engine::spike",
                                    "engine has not drawn #{argb:08X} anywhere in the browser's \
                                     {w}x{h} window yet"
                                );
                            }
                        }
                        // Separate from `probe_missing`, so a transient
                        // unreadable capture cannot silence the "has not drawn"
                        // line that negative controls grep for.
                        None => {
                            every_color_found = false;
                            self.probe_boxes.remove(&argb);
                            if self.probe_unreadable.insert(argb) {
                                warn!(
                                    target: "domicile::engine::spike",
                                    "engine could not read the window at all looking for \
                                     #{argb:08X}, so nothing was measured about it — which is \
                                     not the same as the color being absent"
                                );
                            }
                        }
                    }
                }
                // Logged because guards cannot infer it: boxes are logged only
                // when they move, so a quiet log does not prove the search ran.
                if every_color_found && nothing_moved {
                    self.find_settled = true;
                    tracing::info!(
                        target: "domicile::engine::spike",
                        "engine settled: every color it was looking for held still"
                    );
                }
            }
            // Stamp after capturing, so the interval is a gap between readbacks
            // even when a capture is slow.
            self.last_find = Some(Instant::now());
        }

        // Skipped during a latency run. This capture forces a draw and waits on
        // the submit path, inside the `commit_to_pixel` window. It would double
        // each round's cost and fail the guard's ratio.
        if spike_center_probe()
            && spike_probe_points().is_empty()
            && spike_find_colors().is_empty()
            && spike_latency_point().is_none()
        {
            if let Some(drawn) = session.spike_window_center() {
                tracing::info!(
                    target: "domicile::engine::spike",
                    "engine drew #{drawn:08X} at the center of the browser's window"
                );
            }
        } else {
            for &(x, y) in spike_probe_points() {
                match session.spike_pixel(x, y) {
                    Some(drawn) => tracing::info!(
                        target: "domicile::engine::spike",
                        "engine drew #{drawn:08X} at ({x},{y}) of the browser's window"
                    ),
                    // Logged once per point. A silent probe looks the same as a
                    // page that drew nothing, but the causes differ (missing
                    // symbol or out-of-window point, versus the seam).
                    None => {
                        if self.probe_refused.insert((x, y)) {
                            // Probe the center to tell the causes apart.
                            // `SamplePixel` refuses both a point outside the
                            // window and an undrawn window (empty bitmap). The
                            // center is always inside, so an answer there means
                            // the point is out of bounds.
                            match session.spike_window_center() {
                                Some(center) => warn!(
                                    x,
                                    y,
                                    center = format!("#{center:08X}"),
                                    "the probe refused this point but answered for the \
                                     window's center, so the browser is drawing and this \
                                     point is outside its window"
                                ),
                                None => warn!(
                                    x,
                                    y,
                                    "the probe refused this point AND the window's \
                                     center, so the browser has drawn nothing at all — \
                                     which is not a probe fault and would also stop viz \
                                     ever releasing a client's buffer"
                                ),
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Temporary, part of the spike. Whether to sample what viz drew at the browser
/// window's center. Set by `DOMICILE_SPIKE_CENTER`.
///
/// Opt-in because each readback forces a draw and blocks the submit path.
fn spike_center_probe() -> bool {
    static CENTER: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CENTER.get_or_init(|| std::env::var_os("DOMICILE_SPIKE_CENTER").is_some())
}

/// Temporary, part of the spike. Points in the browser window to sample, from
/// `DOMICILE_SPIKE_PROBE` as `x,y;x,y`.
///
/// Empty by default. The two-window guard names one point per canvas. Parsed
/// once, since it is read at the client's frame rate.
///
/// Malformed entries are dropped with a warning; the guard still fails on
/// missing colors.
fn spike_probe_points() -> &'static [(i32, i32)] {
    static POINTS: std::sync::OnceLock<Vec<(i32, i32)>> = std::sync::OnceLock::new();
    POINTS.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_PROBE") else {
            return Vec::new();
        };
        raw.split(';')
            .filter(|entry| !entry.trim().is_empty())
            .filter_map(|entry| {
                let point = parse_point(entry.trim());
                if point.is_none() {
                    warn!(entry, "DOMICILE_SPIKE_PROBE: not an `x,y` point; ignored");
                }
                point
            })
            .collect()
    })
}

/// Temporary, part of the spike. Colors to find anywhere in the browser window,
/// from `DOMICILE_SPIKE_FIND` as `RRGGBB;RRGGBB` or `AARRGGBB;AARRGGBB`.
///
/// For shell guards, which cannot name a pixel because the shell lays out
/// windows. Six digits mean fully opaque.
fn spike_find_colors() -> &'static [u32] {
    static COLORS: std::sync::OnceLock<Vec<u32>> = std::sync::OnceLock::new();
    COLORS.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_FIND") else {
            return Vec::new();
        };
        parse_find_colors(&raw)
    })
}

/// Parse a [`spike_find_colors`] value. Separate from the env read so it can be
/// tested.
///
/// Malformed entries are dropped with a warning; the guard still fails on
/// missing colors.
fn parse_find_colors(raw: &str) -> Vec<u32> {
    raw.split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let digits = entry.strip_prefix('#').unwrap_or(entry);
            match (digits.len(), u32::from_str_radix(digits, 16)) {
                // Six digits are fully opaque. Window pixels are opaque, so a
                // zero alpha would match nothing.
                (6, Ok(rgb)) => Some(0xFF00_0000 | rgb),
                (8, Ok(argb)) => Some(argb),
                _ => {
                    warn!(
                        entry,
                        "DOMICILE_SPIKE_FIND: not an `RRGGBB` or `AARRGGBB` color; ignored"
                    );
                    None
                }
            }
        })
        .collect()
}

/// Parse `x,y`. Shared by the latency and probe settings so they agree.
pub fn parse_point(entry: &str) -> Option<(i32, i32)> {
    let (x, y) = entry.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::parse_find_colors;

    /// Six digits mean opaque; window pixels are opaque, so no alpha would
    /// match nothing.
    #[test]
    fn a_color_with_no_alpha_is_opaque() {
        assert_eq!(parse_find_colors("19B36B"), vec![0xFF19_B36B]);
    }

    #[test]
    fn an_alpha_that_is_written_down_is_kept() {
        assert_eq!(parse_find_colors("8019B36B"), vec![0x8019_B36B]);
    }

    /// Guards write colors CSS-style, so `#` and spaces are accepted.
    #[test]
    fn a_leading_hash_and_the_spaces_around_an_entry_are_not_part_of_the_color() {
        assert_eq!(
            parse_find_colors(" #19B36B ; CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    /// A typo drops only the mistyped color.
    #[test]
    fn an_entry_that_is_not_a_color_is_dropped_and_the_rest_are_kept() {
        assert_eq!(
            parse_find_colors("19B36B;nonsense;CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    #[test]
    fn nothing_to_look_for_is_nothing_to_look_for() {
        assert!(parse_find_colors("").is_empty());
        assert!(parse_find_colors(";  ;").is_empty());
    }
}
