//! What a real Wayland client is told the screens are.
//!
//! Ported from `scripts/e2e-two-displays.sh`, deleted in the change that added
//! this file. `desktop.rs` is the other half of the same question — what a
//! *chrome* is told over the host socket — and neither substitutes for this
//! one: a compositor can describe two displays to a chrome and advertise one
//! `wl_output`, and every check in this suite but this one would pass.
//!
//! Both halves are unit-tested already: the config normalises the positions
//! and `Screens` decides what to advertise. Neither says a compositor *started
//! on a two-display config* advertises two outputs to a client that connects.
//!
//! The script this replaces argued that by claiming a swap of
//! `Screens::described` for `following_the_window` passes everything else, and
//! that is not true here: two checks in `desktop.rs` catch it, one of them the
//! density guard that swap flips. Turning the feature off is caught. What is
//! not caught without this file is the narrower failure below — the feature on,
//! the chrome told correctly, and the client told something else.
//!
//! # What is here and what is not
//!
//! Two checks, chosen by mutation rather than by which phases the script had.
//! `desktop.rs` already covers the chrome's view of the same compositor, so the
//! question for each was whether it kills something that file does not:
//!
//! | mutation | advertised | enters both | `desktop.rs` |
//! |---|---|---|---|
//! | the client-visible scale forced to 1 | fails | ok | **ok** |
//! | `restate_output`'s `set_preferred` deleted | fails | ok | **ok** |
//! | the app enter loop stops after one screen | ok | fails | **ok** |
//!
//! Three mutations against two checks, which is why two rows share a verdict.
//! Line numbers are left out on purpose: they move — every one quoted in this
//! change's own description went stale within a day — and each site is named
//! by its enclosing function instead.
//!
//! That is the reason this file exists: a compositor can tell a chrome scale 2
//! and advertise scale 1 to a client, leave a mode marked current but not
//! preferred, or describe two screens and put the window on one — and every
//! other check in this repo passes.
//!
//! Three further checks were written and dropped for killing nothing new: a
//! chrome's density leaving a described desktop alone (every mutation that
//! killed it killed `desktop.rs`'s own version, including deleting the guard);
//! the chrome and the client agreeing on how many screens there are (killed
//! only by a mutation that kills four other checks at once); and the
//! undescribed desktop being `compositor.nested_size` — its size half is
//! caught by two checks in `desktop.rs`, its name half by a unit test in
//! `screens.rs`, and even advertising *no* output on that path is caught by
//! `desktop.rs`. The chrome's view and the client's are coupled closely enough
//! there that nothing was left uncovered.
//!
//! # Why this no longer needs `wayland-info`
//!
//! The script asked the compositor what it advertised by running
//! `wayland-info`, and skipped when that was missing. CI installs
//! `wayland-utils`, so it ran there; what it skipped on was every machine
//! without it, where a check that never executed reported a pass.
//! `domicile-test-client --trace` reports the same events, so the client the
//! test already starts is the thing that answers, and there is nothing left to
//! be missing.

mod running;

use crate::running::Compositor;

/// The left display at the origin and the right one beside it, at twice the
/// density.
///
/// Every field has to survive the trip: the position is where the screen sits
/// on the desktop, the size is what a client filling it gets, and the scale is
/// what it draws at.
const TWO_DISPLAYS: &str = r#"{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [2560, 1440], "scale": 2 }
    ]
  }
}"#;

/// What a client should be told those two displays are.
///
/// The right screen's mode is `5120x2880` rather than its configured
/// `2560x1440` because a mode is physical pixels: the logical size times the
/// scale. A compositor reporting the logical size in the mode would have every
/// scaling toolkit draw at a quarter of the area.
const AS_TOLD: [&str; 2] = [
    "left@0,0@1=1920x1080(current preferred)",
    "right@1920,0@2=5120x2880(current preferred)",
];

/// A two-display config becomes two `wl_output`s, each described in full.
#[test]
fn both_configured_displays_are_advertised_to_a_client() {
    let compositor = Compositor::started_with(TWO_DISPLAYS);
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace(".done(", 2),
        "the client was never told about two screens in full; it traced:\n{}",
        client.trace()
    );

    assert_eq!(
        client.screens(),
        AS_TOLD,
        "a client was told the wrong thing about the screens; it traced:\n{}",
        client.trace()
    );
}

/// Advertising two outputs is not putting a window on them.
///
/// A toolkit that scales its content reads `wl_surface.enter` to decide what
/// density to draw at, so a surface entered onto only the first screen is
/// drawn for the wrong one — and nothing in the globals says so. The check
/// above cannot see this: it reads what was advertised, and a compositor that
/// advertises both and enters one passes it.
///
/// Distinct outputs rather than two events, because entering the same screen
/// twice is not two screens and a count alone cannot tell them apart.
#[test]
fn a_window_enters_both_screens_rather_than_the_first() {
    let compositor = Compositor::started_with(TWO_DISPLAYS);
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace(".enter(", 2),
        "the window never entered two screens; it traced:\n{}",
        client.trace()
    );

    let trace = client.trace();
    let mut entered: Vec<&str> = trace
        .lines()
        .filter_map(|line| line.split_once(".enter("))
        .map(|(_, rest)| rest.trim_end_matches(')'))
        .collect();
    entered.sort_unstable();
    entered.dedup();

    assert_eq!(
        entered.len(),
        2,
        "the window entered {} screen(s) and there are two; it traced:\n{}",
        entered.len(),
        trace
    );
}
