//! Tests for the desktop a running compositor describes to chromes.
//!
//! Unit tests cover each part. These check the real binary over a real chrome
//! socket. No Wayland client is needed.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

/// Two displays, the second to the right at twice the density.
const SIDE_BY_SIDE: &str = r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      {
        "name": "right",
        "position": [1920, 0],
        "size": [2560, 1440],
        "scale": 2
      }
    ]
  }
}
"#;

/// An undescribed desktop with scale capped at 2.
///
/// `max_scale` applies only to the output that follows Domicile's window; a
/// described display sets its own scale.
const A_CAP_OF_TWO: &str = r#"
{ "output": { "max_scale": 2 } }
"#;

/// An undescribed desktop with scaling off.
const A_CAP_OF_ONE: &str = r#"
{ "output": { "max_scale": 1 } }
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

/// With no configured displays, the chrome is told one display at the
/// compositor's `UNDESCRIBED_DESKTOP` size.
#[test]
fn a_compositor_with_no_configured_displays_still_describes_one() {
    let compositor = Compositor::started_with("{}");
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
    // Compare every field: the chrome lays out against all of them.
    assert_eq!(described, vec![("domicile-0", [0, 0], [1280, 800], 1)]);
}

/// A density one chrome reports becomes the desktop's scale for every chrome.
///
/// Three chromes cover paths that fail independently: the broadcast to another
/// chrome, the same broadcast to the reporter, and the retained answer a later
/// chrome reads.
#[test]
fn a_density_one_chrome_reports_is_described_to_the_others() {
    let compositor = Compositor::started_with("{}");
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
    // The logical size stays the same as the scale rises.
    assert_eq!(described, vec![("domicile-0", [1280, 800], 2)]);

    // The reporting chrome is told too.
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

    // A later chrome reads the retained answer, written separately from the
    // broadcast.
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

/// A desktop edited on disk reaches a connected chrome and a later one.
///
/// `tests/outputs.rs`'s
/// `a_window_open_across_a_reload_is_told_about_the_display_that_arrived`
/// covers the Wayland side of the same reload.
#[test]
fn a_desktop_edited_on_disk_reaches_the_connected_and_the_latecomer() {
    let compositor = Compositor::started_with(SIDE_BY_SIDE);
    // Wait for the connected chrome to hear the reload before connecting the
    // latecomer, so the two do not race.
    let mut watching = compositor.chrome();
    watching
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");
    compositor.reconfigure(
        r#"
{ "output": { "displays": [{ "name": "only", "size": [1024, 768] }] } }
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

/// A reloaded `output.max_scale` applies to the current desktop and to later
/// densities.
///
/// Users lower the cap on a slow desk with windows open, so the reload must
/// restate the desktop. The two halves are separate code paths: the restated
/// scale is set by the compositor, while the bound on `SetDevicePixelRatio` is
/// read from the hub on the connection thread.
///
/// A refused density sends nothing, so the test follows it with a resize. Both
/// run in order on the Wayland thread, so the resize's answer shows the scale.
///
/// Each wait names a size no earlier message carried. Unmatched messages stay
/// waitable, so a wait matching an earlier description would pass without the
/// reload.
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
    // The mode is in physical pixels, so it drops with the scale.
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

/// Whether a message describes a display of this size and scale.
fn desktop_is(message: &HostMessage, size: [u32; 2], scale: u32) -> bool {
    match message {
        HostMessage::Displays { displays } => displays
            .iter()
            .any(|display| display.size == size && display.scale == scale),
        _ => false,
    }
}

/// A described desktop keeps its configured scales when a chrome reports a
/// density.
///
/// The chrome's `devicePixelRatio` comes from the configured scale, so taking
/// it would let a page overwrite the desktop config. The test checks both the
/// log line and the retained answer, since a refusal sends no message.
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

/// A described desktop keeps its configured sizes when a chrome reports its
/// viewport.
///
/// The config describes the user's real screens, and the chrome's window is a
/// view onto them. Checked as for density above.
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

/// On an undescribed desktop, a size the chrome reports becomes the desktop
/// size for every chrome.
///
/// The browser owns the window, so this message is the only way the compositor
/// learns its size. The size differs from the startup placeholder in both axes
/// so an ignored message fails. The scale must survive the resize.
#[test]
fn a_size_one_chrome_reports_becomes_the_desktop() {
    let compositor = Compositor::started_with("{}");
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
