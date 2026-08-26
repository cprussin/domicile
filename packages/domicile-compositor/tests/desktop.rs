//! What a compositor tells a chrome about the desktop it came up on.
//!
//! Ported from `scripts/e2e-displays-on-hello.sh` and
//! `scripts/e2e-desktop-changed.sh`, both deleted in the change that added
//! this file — so those paths are history rather than somewhere to look. Each
//! half of this is unit-tested already —
//! the config normalises the positions, `Host` answers `hello` with the list,
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
const SIDE_BY_SIDE: &str = r#"{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [2560, 1440], "scale": 2 }
    ]
  }
}"#;

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
/// The size is *stated* rather than defaulted, so what is asserted below is
/// about the config rather than about a constant: `domicile-config` unit-tests
/// that `compositor.nested_size` parses, and this is the only thing showing it
/// survives the trip and comes out as the desktop a page lays out against.
#[test]
fn a_compositor_with_no_configured_displays_still_describes_one() {
    let compositor =
        Compositor::started_with(r#"{ "compositor": { "nested_size": [1024, 640] } }"#);
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
    assert_eq!(described, vec![("domicile-0", [0, 0], [1024, 640], 1)]);
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
    // Stated for the same reason as above: the size held across the density
    // change is the one this config chose, not a default that would look the
    // same whatever reached the compositor.
    let compositor = Compositor::started_with(r#"{ "compositor": { "nested_size": [900, 600] } }"#);
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
    assert_eq!(described, vec![("domicile-0", [900, 600], 2)]);

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
    assert_eq!(displays[0].size, [900, 600]);

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
/// that arrives afterwards.
///
/// The chrome-socket half of `scripts/e2e-reload-displays.sh`, which still
/// runs: that script also opens a real window across the reload, which needs a
/// Wayland client and so cannot live here yet. What is here is the half that
/// needs neither, and it runs everywhere rather than skipping for want of
/// weston.
///
/// One test rather than two, because the reload path describes and broadcasts
/// from one expression (`main.rs:2638-2645`): no mutation separates "the
/// connected chrome was told" from "the retained answer was updated", so a
/// second compositor process would buy nothing.
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
        r#"{
  "output": {
    "displays": [{ "name": "only", "size": [1024, 768] }]
  }
}"#,
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

/// And a described desktop keeps the scale its config gave it.
///
/// The other side of the density path (`set_output_scale`'s refusal). A
/// configured display states its own scale, so a chrome reporting a different
/// `devicePixelRatio` is reporting back a density it was handed — taking it
/// would let a page overwrite the desktop it was told to lay out against.
///
/// Not the only cover for this branch: `scripts/e2e-two-displays.sh` phase 3
/// drives the same refusal and then re-reads `wl_output`, which is stricter
/// than anything reachable from here. What this adds is that it runs at all —
/// that script needs `wayland-info` *and* `weston-terminal`, so on a machine
/// without them the branch is covered by a skip, and a skip is not evidence.
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
