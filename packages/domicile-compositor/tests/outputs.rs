//! What a real Wayland client is told the screens are.
//!
//! Ported from `scripts/e2e-two-displays.sh`, deleted in the change that added
//! this file, and from `scripts/e2e-one-window-per-display.sh`, deleted in the
//! change that added the third check.
//!
//! `desktop.rs` is the other half of the same question — what a *chrome* is
//! told over the host socket — and neither substitutes for this one: a
//! compositor can describe two displays to a chrome and advertise one
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
//! Three checks, chosen by mutation rather than by which phases the scripts
//! had. The question for each was whether it kills something no other test in
//! the workspace does, so the last column is every other test there is — run
//! with `--no-fail-fast`, since a run that stops at the first failing target
//! says nothing about the targets after it:
//!
//! | mutation | advertised | enters both | placed | elsewhere |
//! |---|---|---|---|---|
//! | the client-visible scale forced to 1 | fails | ok | ok | **ok** |
//! | `restate_output`'s `set_preferred` deleted | fails | ok | ok | **ok** |
//! | `new_toplevel`'s enter loop stops after one screen | ok | fails | ok | **ok** |
//! | the toplevels entered by `None` — never narrowed | ok | ok | fails | **ok** |
//! | `enter_only`'s `leave` branch deleted | ok | ok | fails | **ok** |
//! | `enter_only` stopping at the first screen it enters | ok | ok | fails | **ok** |
//!
//! Six mutations against three checks, which is why some rows share a verdict.
//! Line numbers are left out on purpose: they move — every one quoted in this
//! change's own description went stale within a day — and each site is named
//! by its enclosing function instead.
//!
//! The last three rows are what the third check is for, and each is the
//! *application* of the narrowing rather than the rule: `Portal::bounds`
//! squares off a placement and `Screens::entered_by` decides which outputs it
//! touches, both unit-tested, and neither says a running compositor sends
//! `wl_surface.enter` and `leave` to a real client when a real chrome places
//! it.
//!
//! The last of the three is why `enter_only` has to be read as a whole. It
//! enters the right screen for every window and still fails, because the
//! `break` skips the *leaves* for the outputs after the one it entered — so
//! the window on the left screen keeps the right one it entered on map.
//!
//! Which is also why the check reads leaves: every surface enters every output
//! when it maps, before there is a portal to place it by, so an enters-only
//! reading answers `[left, right]` for both windows however the chrome moves
//! them — it does not merely miss a broken compositor, it fails a correct one.
//! Measured, by making the reading blind to `leave` on an unmutated head. An
//! earlier version of this said such a reading would *pass* a compositor that
//! never narrows. It would not — it fails that one too, and answers
//! identically for both, which is the point: an enters-only reading cannot
//! tell a compositor that never narrows from one that does, so it is no
//! argument either way.
//!
//! That is the reason this file exists: a compositor can tell a chrome scale 2
//! and advertise scale 1 to a client, leave a mode marked current but not
//! preferred, describe two screens and put the window on one, or leave every
//! window on every screen however the chrome moves it — and every other check
//! in this repo passes.
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

use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::{Client, Compositor};

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

/// Where the chrome puts each window, in the desktop's own coordinates.
///
/// Well inside its display rather than up against the edge, so a rounding
/// disagreement between a placement and an output's rectangle cannot be what
/// this measures. The right display starts at x=1920, so the second window is
/// 400 past its left edge.
const PLACED_AT: [(&str, [f64; 2]); 2] = [("left", [400.0, 200.0]), ("right", [2320.0, 200.0])];

/// The app id the compositor gave the window titled `title`.
///
/// By name rather than by arrival, because `app_appeared` carries no title —
/// a client names its window in the request after the one that creates the
/// toplevel — and which of two clients mapped first is not something a test
/// can arrange. `app_titled` is what binds an id to a client.
fn window_called(chrome: &mut domicile_test_chrome::Chrome, title: &str) -> String {
    let told = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::AppTitled { title: named, .. }
                if named.as_deref() == Some(title))
        })
        .unwrap_or_else(|err| panic!("the compositor never named the window {title:?}: {err}"));
    match told {
        HostMessage::AppTitled { app_id, .. } => app_id,
        other => unreachable!("waited for a title and got {other:?}"),
    }
}

/// Put `app_id` at `at`, the size the probe this replaces used.
fn place(chrome: &mut domicile_test_chrome::Chrome, app_id: &str, at: [f64; 2]) {
    chrome
        .say(&ChromeMessage::PlacePortal {
            app_id: app_id.to_string(),
            corner_radius: 0.0,
            native: true,
            opacity: 1.0,
            shadow: None,
            // Small enough to sit inside either display.
            size: [400.0, 300.0],
            takes_pointer: true,
            // A plain translation: `size` is the window's own pixels and this
            // is where the page put them, which is what the compositor turns
            // into a rectangle on the desktop.
            transform: [1.0, 0.0, 0.0, 1.0, at[0], at[1]],
            visible: true,
            z_index: 0,
        })
        .expect("the chrome socket takes a placement");
}

/// Once the chrome has placed a window, the client is told the one screen it
/// is over — and told it has left the other.
///
/// The check above is the fallback: an *unplaced* surface enters every output,
/// which is all there was to assert while every surface did. This is the rule.
/// Both halves are unit-tested — `Portal::bounds` squares off a placement and
/// `Screens::entered_by` decides which outputs it touches — and neither says a
/// running compositor sends `wl_surface.enter` and `leave` to a real client
/// when a real chrome places it.
///
/// Both windows, though the left one is what does the work: every mutation in
/// the table above that this check kills, it kills through the left-hand
/// window, and the `enter_only`-`break` row *only* through it — there the
/// right-hand window is already correct. The right half is one element of a
/// tuple and costs nothing, so it stays; what it is not is the reason this
/// check kills anything. An earlier version of this comment said it was, by
/// reasoning about a compositor that reports the first output for everything.
/// That compositor does need the right half — and also fails `screens.rs`'s own
/// unit tests, which is the bar this file sets for itself. How many depends on
/// how it is spelled, which is the other reason not to argue from it:
/// `entered_by` answering with the first output unconditionally fails four of
/// them (and this check); narrowing to the first output a placement *touches*
/// fails one, and this check not at all.
///
/// Needs a chrome, because a placement is the only thing that narrows the set
/// and only a chrome can send one.
#[test]
fn a_placed_window_is_told_the_screen_it_is_on_and_no_other() {
    let compositor = Compositor::started_with(TWO_DISPLAYS);
    let mut chrome = compositor.chrome();

    let clients: Vec<Client> = PLACED_AT
        .iter()
        .map(|(screen, _)| compositor.client(screen))
        .collect();
    for (screen, at) in PLACED_AT {
        let app_id = window_called(&mut chrome, screen);
        place(&mut chrome, &app_id, at);
    }

    // Waited for the answer rather than for its shape. Both clients enter both
    // screens on map, before there is a portal to place them by, so a wait
    // that stopped as soon as each was on *some* one screen would stop on a
    // one-screen state that is one screen for the wrong reason — measured: a
    // compositor whose `new_toplevel` enters only the first output puts each
    // window on one screen immediately, and a length test ends the wait before
    // any placement is processed. Fourteen of thirty runs then failed on the
    // un-narrowed state, and the mutation table above called that row `ok`.
    //
    // Comparing against the expected value costs nothing — the check still
    // settles in about a fifth of a second — and a transient reading, of which
    // a growing trace has several, simply costs another turn of the loop
    // rather than ending it.
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until
        && clients
            .iter()
            .zip(PLACED_AT)
            .any(|(client, (screen, _))| client.on_screens() != [screen])
    {
        // A plain sleep, and not a read of the chrome socket. Draining it was
        // once load-bearing here and is not any more: `write_responses`
        // returns before the writer lock for an answer with nothing in it, so
        // a chrome that only speaks no longer parks the compositor's reader,
        // and the one message that still would — `hello` — this check sends
        // exactly once, in `Chrome::connect`, before the loop. Measured: with
        // this sleep and no read at all, twenty-five runs of twenty-five.
        std::thread::sleep(Duration::from_millis(20));
    }

    let on: Vec<Vec<String>> = clients.iter().map(Client::on_screens).collect();
    assert_eq!(
        on,
        vec![vec!["left".to_string()], vec!["right".to_string()]],
        "the windows were told the wrong screens; they traced:\n{}\n---\n{}",
        clients[0].trace(),
        clients[1].trace()
    );
}
