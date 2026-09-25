//! What a compositor tells a chrome about the desktop it came up on.
//!
//! Ported from `scripts/e2e-displays-on-hello.sh` and
//! `scripts/e2e-desktop-changed.sh`, both deleted in the change that added
//! this file — so those paths are history rather than somewhere to look. Each
//! half of this is unit-tested already —
//! the config normalizes the positions, `Host` answers `hello` with the list,
//! the SDK's schema decodes it — and none of that proves a compositor *started
//! on a two-display config* describes two displays to a real chrome over a real
//! socket.
//!
//! No display and no Wayland client: the handshake is the whole of it.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

/// Two displays, the second beside the first at twice the density. Both facts
/// have to survive the trip: the position is where a `<Screen>` goes on the
/// page, and the scale is what clients on that display draw at.
const SIDE_BY_SIDE: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[[output.displays]]
name = "right"
position = [1920, 0]
size = [2560, 1440]
scale = 2
"#;

/// A desktop nothing describes, so the window's own density decides it, with
/// room for a retina one.
///
/// No `output.displays`: `max_scale` governs the single output that follows
/// Domicile's window, and a described display states its own scale instead.
const A_CAP_OF_TWO: &str = r#"
[output]
max_scale = 2
"#;

/// The same desk with scaling turned off, which is what `1` means.
const A_CAP_OF_ONE: &str = r#"
[output]
max_scale = 1
"#;

#[test]
fn a_chrome_is_told_the_whole_desktop_at_the_handshake() {
    let compositor = Compositor::started_with(SIDE_BY_SIDE);
    let mut chrome = compositor.chrome();

    let described = chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    let described: Vec<_> = displays
        .iter()
        .map(|display| {
            (
                display.name.as_str(),
                display.position,
                display.size,
                display.scale,
            )
        })
        .collect();
    assert_eq!(
        described,
        vec![
            ("left", [0, 0], [1920, 1080], 1),
            ("right", [1920, 0], [2560, 1440], 2),
        ]
    );
}

/// A compositor told nothing about displays still has a desktop — the single
/// output that follows its own window — and still says so.
///
/// The size is the compositor's own `UNDESCRIBED_DESKTOP`, which is the whole
/// of what an unconfigured run has to go on: there is no setting to state it
/// with any more, so what this shows is that a page is handed a desktop to lay
/// out against before anything has described one.
#[test]
fn a_compositor_with_no_configured_displays_still_describes_one() {
    let compositor = Compositor::started_with("");
    let mut chrome = compositor.chrome();

    let described = chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("there is always a desktop");

    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    let described: Vec<_> = displays
        .iter()
        .map(|display| {
            (
                display.name.as_str(),
                display.position,
                display.size,
                display.scale,
            )
        })
        .collect();
    // The whole tuple, not just the count: what a chrome lays out against is
    // every field of it, and the size is the one this config stated. A length
    // check passes just as well on a desktop of one display 0 pixels wide.
    assert_eq!(described, vec![("domicile-0", [0, 0], [1280, 800], 1)]);
}

/// The other way a desktop changes: a chrome that says how dense it is.
///
/// What `scripts/e2e-desktop-changed.sh` was about, before the change that
/// added this file deleted it. A window-following desktop takes the chrome's `devicePixelRatio` as
/// its output scale, and that is a fact about the desktop — so every chrome
/// has to hear it, not only the one that reported it.
///
/// Three chromes, because there are three ways to be told and each fails on
/// its own. The page connected *before* and asking for nothing is reached only
/// by a broadcast. The page that *asked* would be told either way, so it
/// cannot stand in for the first — an earlier version of the script used it as
/// both and passed against a unicast to the requester. And the page connecting
/// *after* reads the retained answer, which a compositor that describes the
/// desktop once at startup never updates.
#[test]
fn a_density_one_chrome_reports_is_described_to_the_others() {
    let compositor = Compositor::started_with("");
    let mut watching = compositor.chrome();
    let mut reporting = compositor.chrome();
    watching
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    reporting
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: 2.0 })
        .expect("the chrome reports its density");

    let described = watching
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => displays.iter().any(|display| display.scale == 2),
            _ => false,
        })
        .expect("the new density reaches the chrome that did not report it");

    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    let described: Vec<_> = displays
        .iter()
        .map(|display| (display.name.as_str(), display.size, display.scale))
        .collect();
    // The size holds while the scale climbs: a denser display is a sharper
    // desktop rather than a smaller one, and a chrome told otherwise would
    // halve its own layout.
    assert_eq!(described, vec![("domicile-0", [1280, 800], 2)]);

    // The second way, and the one the deleted script called its weak arm: the
    // chrome that asked. Told over the same broadcast rather than answered
    // directly, so a compositor that replied to everyone *except* the
    // connection that asked is convicted here and nowhere else.
    let told = reporting
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => displays.iter().any(|display| display.scale == 2),
            _ => false,
        })
        .expect("the chrome that reported the density is told the desktop too");
    let HostMessage::Displays { displays } = told else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(displays[0].size, [1280, 800]);

    // And the third way: the retained answer, which is a separate write from
    // the broadcast above and has gone stale on its own before.
    let mut latecomer = compositor.chrome();
    let told = latecomer
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("a latecomer is told the desktop too");
    let HostMessage::Displays { displays } = told else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(
        displays
            .iter()
            .map(|display| display.scale)
            .collect::<Vec<_>>(),
        vec![2],
        "a chrome that connected after the density changed must not be told \
         the old one"
    );
}

/// A desktop edited on disk reaches both a chrome already connected and one
/// that arrives afterward.
///
/// The chrome-socket half of `scripts/e2e-reload-displays.sh`, deleted in the
/// change that finished porting it. The other half — a real window open across
/// the reload, which needs a Wayland client and so cannot live here — is
/// `tests/outputs.rs`'s
/// `a_window_open_across_a_reload_is_told_about_the_display_that_arrived`.
/// Neither substitutes for the other: deleting `adopt_the_desktop`'s re-narrow
/// leaves this check passing, because the chrome is told the new desktop by a
/// different line further down the same function.
///
/// One test rather than two, because the reload path describes and broadcasts
/// from one expression — `adopt_the_desktop`'s, at the end of it. No mutation
/// separates "the connected chrome was told" from "the retained answer was
/// updated", so a second compositor process would buy nothing. Named rather
/// than numbered: the line range this used to quote had drifted onto an
/// unrelated branch, which is the rule `outputs.rs` states for itself.
#[test]
fn a_desktop_edited_on_disk_reaches_the_connected_and_the_latecomer() {
    let compositor = Compositor::started_with(SIDE_BY_SIDE);
    // One chrome first, so the reload is observed rather than raced: the
    // compositor has taken the new desktop up by the time it has said so to
    // somebody.
    let mut watching = compositor.chrome();
    watching
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");
    compositor.reconfigure(
        r#"
[[output.displays]]
name = "only"
size = [1024, 768]
"#,
    );
    let described = watching
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => displays.len() == 1,
            _ => false,
        })
        .expect("the new desktop reaches the chrome that was already connected");
    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(displays[0].name, "only");

    let mut latecomer = compositor.chrome();
    let described = latecomer
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("a latecomer is told the desktop too");

    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(
        displays
            .iter()
            .map(|display| display.name.as_str())
            .collect::<Vec<_>>(),
        vec!["only"],
        "a chrome that connected after the change must not be told the old desktop"
    );
}

/// A cap edited on disk is the cap the desktop is advertised under, now and
/// for the next density a chrome reports.
///
/// `output.max_scale` is a cost dial — a client asked for scale N draws N²
/// times the pixels — so the edit a person makes is the one they make when a
/// desk is too slow, with windows open on it. A reload that stored the number
/// and left the desktop at the old one is the shape of "the save did nothing".
///
/// Both claims in one check, because they are one sequence and the second
/// needs the first to have happened to be observable at all. They are separate
/// mutations, though, and the assertions say which is which: the scale the
/// desktop is restated at is the compositor's own, while the cap a later
/// `SetDevicePixelRatio` is bounded by is read on the connection thread, from
/// the hub.
///
/// The second half asserts an absence without waiting for one. A density that
/// is refused sends nothing, so the desktop is resized *after* it and the
/// answer to that carries the scale: the two messages are handled in order on
/// the one Wayland thread, so a cap that had gone stale would have raised the
/// scale before the size arrived and be reported by the line that reads it.
///
/// **Every wait names a size no earlier message carried.** A match is consumed
/// but the messages it was found behind stay waitable, so a wait for "scale 1"
/// on a desktop that *started* at scale 1 is answered by the handshake — the
/// reload need never have happened. The window is resized between the phases
/// so each one is a desktop nothing has described before.
#[test]
fn a_cap_edited_on_disk_bounds_the_desktop_and_the_next_density() {
    let compositor = Compositor::started_with(A_CAP_OF_TWO);
    let mut chrome = compositor.chrome();
    chrome
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: 2.0 })
        .expect("the chrome reports its density");
    chrome
        .say(&ChromeMessage::SetDesktopSize {
            size: [1000.0, 700.0],
        })
        .expect("and how big its window is");
    chrome
        .wait_for(|message| desktop_is(message, [1000, 700], 2))
        .expect("a chrome on a dense display takes the desktop up to scale 2");

    compositor.reconfigure(A_CAP_OF_ONE);

    let told = chrome
        .wait_for(|message| desktop_is(message, [1000, 700], 1))
        .expect("the reloaded cap reaches the desktop that is up");
    let HostMessage::Displays { displays } = told else {
        unreachable!("the wait matched on this");
    };
    // The mode comes down with the scale and the logical size holds: the mode
    // is physical pixels, so a desktop that dropped a density draws fewer of
    // them over the same screen.
    assert_eq!(
        displays[0].mode,
        [1000, 700],
        "the mode is the logical size at the cap the file now states"
    );

    chrome
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: 3.0 })
        .expect("the chrome reports a density the new cap refuses");
    chrome
        .say(&ChromeMessage::SetDesktopSize {
            size: [900.0, 600.0],
        })
        .expect("and then a size, which is answered");

    let told = chrome
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => {
                displays.iter().any(|display| display.size == [900, 600])
            }
            _ => false,
        })
        .expect("the resized desktop reaches the chrome");
    let HostMessage::Displays { displays } = told else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(
        displays[0].scale, 1,
        "a density reported after the edit is bounded by the cap the edit set"
    );
}

/// Whether a message describes a one-display desktop of exactly this size and
/// density.
fn desktop_is(message: &HostMessage, size: [u32; 2], scale: u32) -> bool {
    match message {
        HostMessage::Displays { displays } => displays
            .iter()
            .any(|display| display.size == size && display.scale == scale),
        _ => false,
    }
}

/// And a described desktop keeps the scale its config gave it.
///
/// The other side of the density path (`set_output_scale`'s refusal). A
/// configured display states its own scale, so a chrome reporting a different
/// `devicePixelRatio` is reporting back a density it was handed — taking it
/// would let a page overwrite the desktop it was told to lay out against.
///
/// The only cover for this branch now. `scripts/e2e-two-displays.sh` phase 3
/// drove the same refusal and then re-read `wl_output`, which was stricter
/// than anything reachable from here — but it needed `wayland-info`, so it
/// covered the branch only on machines that had it. When that script was
/// ported to `tests/outputs.rs`, the client-side half of this refusal was
/// written and then dropped: every mutation that killed it killed this check
/// too, so it was a second spelling rather than a second cover.
///
/// Two assertions, because the refusal is one arm of an `if` and the log is
/// the other: a compositor that wrote the line and re-described the desktop
/// anyway is what the second one catches. The desktop is read off a chrome
/// that connects *after* the report — the retained answer — because a refusal
/// sends no message, and waiting for one not to arrive is a sleep.
#[test]
fn a_described_desktop_refuses_a_chromes_density() {
    let compositor = Compositor::started_with(SIDE_BY_SIDE);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    chrome
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: 3.0 })
        .expect("the chrome reports its density");

    compositor.wait_for_log("a described desktop keeps its own scale");

    let mut latecomer = compositor.chrome();
    let described = latecomer
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop is still described");
    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    let described: Vec<_> = displays
        .iter()
        .map(|display| (display.name.as_str(), display.size, display.scale))
        .collect();
    assert_eq!(
        described,
        vec![("left", [1920, 1080], 1), ("right", [2560, 1440], 2)],
        "the config's own scales, not the one the chrome reported"
    );
}

/// And the same for the size, which is the other half of the same mode.
///
/// A described desktop is the config's statement about the user's real
/// screens. The chrome's window is one view onto it — dragging that window
/// shows more or less of the desktop rather than resizing it — so a chrome
/// reporting its viewport must not redefine what the config described.
///
/// Written the same way as the density above and for the same reasons: two
/// assertions because the refusal is one arm of an `if` and the log is the
/// other, and the desktop read off a chrome that connects *after* the report,
/// because a refusal sends no message and waiting for one not to arrive is a
/// sleep.
#[test]
fn a_described_desktop_refuses_a_chromes_size() {
    let compositor = Compositor::started_with(SIDE_BY_SIDE);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    chrome
        .say(&ChromeMessage::SetDesktopSize {
            size: [640.0, 480.0],
        })
        .expect("the chrome reports its viewport");

    compositor.wait_for_log("a described desktop keeps its own size");

    let mut latecomer = compositor.chrome();
    let described = latecomer
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop is still described");
    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    let described: Vec<_> = displays
        .iter()
        .map(|display| (display.name.as_str(), display.size, display.scale))
        .collect();
    assert_eq!(
        described,
        vec![("left", [1920, 1080], 1), ("right", [2560, 1440], 2)],
        "the config's own sizes, not the 640x480 the chrome reported"
    );
}

/// **THE DESKTOP IS THE CHROME'S WINDOW.** A size the chrome reports replaces
/// the one the run started at, and every chrome is told.
///
/// This is the whole of how a desktop learns how big it is under the forked
/// engine: the window is the browser's and the compositor never sees it.
/// Before this message the desktop stayed at the startup placeholder however
/// big the window was — observed on a real machine as a chrome laid out for
/// 1280x800 sitting in the corner of a much larger one, with `advertising
/// output scale width=1280 height=800` in the log next to a chrome reporting
/// `devicePixelRatio` 1.5.
///
/// The reported size is deliberately neither half of that placeholder, so a
/// compositor that ignored the message and kept its own would fail here rather
/// than coincide with it.
///
/// The scale is asserted to hold across the resize for the same reason the
/// size is asserted to hold across a density change above: a mode is both, and
/// restating one must not silently reset the other.
#[test]
fn a_size_one_chrome_reports_becomes_the_desktop() {
    let compositor = Compositor::started_with("");
    let mut watching = compositor.chrome();
    let mut reporting = compositor.chrome();
    watching
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    reporting
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: 2.0 })
        .expect("the chrome reports its density");
    reporting
        .say(&ChromeMessage::SetDesktopSize {
            size: [1600.0, 1200.0],
        })
        .expect("the chrome reports its viewport");

    let described = watching
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => {
                displays.iter().any(|display| display.size == [1600, 1200])
            }
            _ => false,
        })
        .expect("the new size reaches the chrome that did not report it");

    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    let described: Vec<_> = displays
        .iter()
        .map(|display| (display.name.as_str(), display.size, display.scale))
        .collect();
    assert_eq!(
        described,
        vec![("domicile-0", [1600, 1200], 2)],
        "the reported size, at the density reported before it"
    );
}

/// A window that says which display it covers is answered with the desk, that
/// display at the origin and told it fills the window.
///
/// **THE ANSWER IS THE WHOLE FEATURE.** A desk of several monitors is several
/// windows, each loading the same shell, and `set_screen` is the only thing
/// that differs between them: without the move every window lays its regions
/// out in the whole desktop's coordinates and draws the desktop's top-left
/// corner. `fills_the_window` is the other half — it is what tells a page
/// which display is its own, and a page told `false` draws every display of
/// the desk on top of its one monitor. It is one display's, because a page may
/// draw on one monitor.
///
/// It went out `false` for a whole release. `as_seen_from` was right and
/// unit-tested, and `freshened` — on the write path, and written when the
/// handshake was the only response carrying a desktop — replaced the answer
/// with `describe_desktop()` on its way to the socket. Nothing compared what
/// was built with what was sent, which is what this does.
#[test]
fn a_window_that_says_which_display_it_covers_is_answered_with_that_display() {
    let compositor = Compositor::started_with(SIDE_BY_SIDE);
    let mut chrome = compositor.chrome();

    // The handshake first, which is the whole desktop and fills nobody's
    // window — waited on so the answer below is the *next* description rather
    // than this one.
    let handshake = chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");
    let HostMessage::Displays { displays } = handshake else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(displays.len(), 2, "the handshake is the whole desktop");
    assert!(
        displays.iter().all(|display| !display.fills_the_window),
        "a desktop is not anybody's viewport: {displays:?}"
    );

    chrome
        .say(&ChromeMessage::SetScreen {
            name: "right".to_string(),
        })
        .expect("a chrome can say which window it is");

    let answer = chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("naming a window is answered with that window's desk");
    let HostMessage::Displays { displays } = answer else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(
        displays.len(),
        2,
        "a window is one screen OF a desk, and the shell lays out against \
         both: {displays:?}"
    );
    let window = displays
        .iter()
        .find(|display| display.name == "right")
        .expect("the window's own display is in the desk it was sent");
    assert_eq!(
        window.position,
        [0, 0],
        "a window IS its display, so within it that display starts at zero"
    );
    assert!(
        window.fills_the_window,
        "the page draws on its own display alone, and this is what tells it \
         which one: {window:?}"
    );
    assert!(
        displays
            .iter()
            .filter(|display| display.name != "right")
            .all(|display| !display.fills_the_window),
        "and it may draw on no other monitor: {displays:?}"
    );
}
