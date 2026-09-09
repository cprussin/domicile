//! What a real Wayland client is told the screens are.
//!
//! Ported from three scripts, each deleted in the change that added the check
//! replacing it: `e2e-two-displays.sh` (this file's first two),
//! `e2e-one-window-per-display.sh`, and the client half of
//! `e2e-reload-displays.sh` (the third).
//!
//! `desktop.rs` is the other half of the same question — what a *chrome* is
//! told over the host socket — and neither substitutes for the other: a
//! compositor can describe two displays to a chrome and advertise one
//! `wl_output`, and it can take a reloaded desktop up for the chrome while
//! leaving every window already open on the displays there used to be.
//!
//! Both halves are unit-tested already: the config normalises the positions
//! and `Screens` decides what to advertise. Neither says a compositor *started
//! on a two-display config* advertises two outputs to a client that connects.
//!
//! `e2e-two-displays.sh` argued that by claiming a swap of
//! `Screens::described` for `following_the_window` passes everything else, and
//! that is not true here: two checks in `desktop.rs` catch it, one of them the
//! density guard that swap flips. Turning the feature off is caught. What is
//! not caught without this file is the narrower failure below — the feature on,
//! the chrome told correctly, and the client told something else.
//!
//! # What is here and what is not
//!
//! Three checks, chosen by mutation rather than by which phases the scripts
//! had. The question for each was whether it kills something no other test in
//! the workspace does, so the last column is every other test there is — run
//! with `--no-fail-fast`, since a run that stops at the first failing target
//! says nothing about the targets after it:
//!
//! | mutation | advertised | enters both | reload | elsewhere |
//! |---|---|---|---|---|
//! | the client-visible scale forced to 1 | fails | ok | ok | **ok** |
//! | `restate_output`'s `set_preferred` deleted | fails | ok | ok | **ok** |
//! | `new_toplevel`'s enter loop stops after one screen | ok | fails | fails | **ok** |
//! | `adopt_the_desktop`'s re-narrow deleted | ok | ok | fails | **ok** |
//!
//! Line numbers are left out on purpose: they move — every one quoted in this
//! change's own description went stale within a day — and each site is named
//! by its enclosing function instead.
//!
//! # A window is on every display, and that is the whole rule now
//!
//! There was a fourth check here, and a narrowing for it to check: the chrome
//! reported where it had put each window, `Screens::entered_by` worked out
//! which outputs that rectangle touched, and the client was told the one
//! screen it was on. Three of the mutations above existed for it.
//!
//! Placement is gone — the page has stopped reporting where its own boxes are,
//! because layout positions the layer — so there is nothing left to narrow by
//! and every surface enters every display. That is not a gap this file papers
//! over; it is what the compositor does, and `enter_the_displays_each_window_is_on`
//! in `main.rs` names `<Screen name="left">` as the way a shell will say which
//! display it means. When that exists, the check comes back with it.
//!
//! The remaining two checks that touch enters read `wl_surface.leave` as well,
//! and still should: the reload check turns on a window entering a display
//! that arrived after it mapped, and a reading blind to leaves cannot tell a
//! compositor that re-narrows from one that never did.
//!
//! That is the reason this file exists: a compositor can tell a chrome scale 2
//! and advertise scale 1 to a client, leave a mode marked current but not
//! preferred, or take up a new display for the desktop and not for the windows
//! already on it — and every other check in this repo passes.
//!
//! Three others were written and dropped for killing nothing new: a
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
//! `e2e-two-displays.sh` asked the compositor what it advertised by running
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

/// The one display this reload starts from.
const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// A window already open when a display appears is told it is on it.
///
/// The compositor takes up an edited config while it runs, and `desktop.rs`
/// covers what the *chrome* is told about that. This is the other end: a
/// client that mapped against the old desktop and is still running. Nothing
/// else will tell it — a toolkit that scales its content picks its density
/// from `wl_surface.enter`, so a window that never entered the screen that
/// arrived goes on drawing for the old one on it.
///
/// It was uncovered: deleting `adopt_the_desktop`'s re-narrow passes the whole
/// workspace, `desktop.rs` included, because the chrome is told the new
/// desktop by a different line further down the same function.
///
/// The client is started and waited for *before* the edit, so this is a window
/// the reload finds rather than one that mapped onto the finished desktop and
/// would have entered both anyway. Two is the answer because a window belongs
/// on every display; what this turns on is that the display which arrived is
/// one of them.
#[test]
fn a_window_open_across_a_reload_is_told_about_the_display_that_arrived() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace(".enter(", 1),
        "the window never entered the one screen there was, so the reload \
         below has nothing to add to; it traced:\n{}",
        client.trace()
    );

    compositor.reconfigure(TWO_DISPLAYS);
    compositor.wait_for_log("taking up a reloaded desktop");

    assert!(
        client.wait_for_trace(".enter(", 2),
        "the window was open when the second display appeared and was never \
         told it is on it; it traced:\n{}",
        client.trace()
    );

    assert_eq!(
        client.on_screens(),
        vec!["left".to_string(), "right".to_string()],
        "the window is on the wrong screens after the reload; it traced:\n{}",
        client.trace()
    );
}
