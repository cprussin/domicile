//! Behaviour tests for `domicile-protocol`, written before the implementation.
//!
//! This crate defines the wire contract between the Rust host and the in-page
//! client (JS). Two things matter and are tested here:
//!  1. Every message round-trips through JSON unchanged.
//!  2. The on-the-wire shape is stable (the JS side hard-codes these strings),
//!     so we pin the tag/field names explicitly.

use domicile_protocol::{
    negotiate, ChromeMessage, CursorShape, DisplayInfo, HostMessage, PROTOCOL_VERSION,
};

fn chrome_round_trip(msg: &ChromeMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let back: ChromeMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(*msg, back, "round-trip changed the message (json: {json})");
}

fn host_round_trip(msg: &HostMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let back: HostMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(*msg, back, "round-trip changed the message (json: {json})");
}

#[test]
fn chrome_messages_round_trip() {
    chrome_round_trip(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    });
    chrome_round_trip(&ChromeMessage::FocusApp {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::SetDevicePixelRatio { ratio: 1.5 });
    chrome_round_trip(&ChromeMessage::FocusChrome);
    chrome_round_trip(&ChromeMessage::CloseApp {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::Spawn {
        command: vec!["kitty".into(), "--hold".into()],
    });
    chrome_round_trip(&ChromeMessage::PointerMotion {
        app_id: "term".into(),
        x: 12.5,
        y: 3.0,
    });
    chrome_round_trip(&ChromeMessage::PointerLeave {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::PointerButton {
        app_id: "term".into(),
        button: 0x110,
        pressed: true,
    });
    chrome_round_trip(&ChromeMessage::PointerAxis {
        app_id: "term".into(),
        dx: 0.0,
        dy: -15.0,
        v120_x: 0,
        v120_y: -120,
    });
    chrome_round_trip(&ChromeMessage::ResizeApp {
        app_id: "term".into(),
        size: [800.0, 600.0],
    });
    chrome_round_trip(&ChromeMessage::Key {
        app_id: "term".into(),
        keycode: 30,
        pressed: true,
    });
}

#[test]
fn spawn_wire_shape_is_pinned() {
    let v = serde_json::to_value(ChromeMessage::Spawn {
        command: vec!["kitty".into()],
    })
    .unwrap();
    assert_eq!(v["type"], "spawn");
    assert_eq!(v["command"][0], "kitty");
}

#[test]
fn host_messages_round_trip() {
    host_round_trip(&HostMessage::Welcome {
        protocol_version: PROTOCOL_VERSION,
    });
    host_round_trip(&HostMessage::AppAppeared {
        app_id: "term".into(),
        title: Some("Terminal".into()),
        size: Some([640.0, 480.0]),
    });
    // A client that has not committed yet, which is every client at the
    // moment this message goes out.
    host_round_trip(&HostMessage::AppAppeared {
        app_id: "x".into(),
        title: None,
        size: None,
    });
    host_round_trip(&HostMessage::AppTitled {
        app_id: "term".into(),
        title: Some("a terminal".into()),
    });
    // A client saying it has no name, which is `set_title("")` and not an
    // absent title: xdg-shell has no request that takes a name back.
    host_round_trip(&HostMessage::AppTitled {
        app_id: "term".into(),
        title: Some(String::new()),
    });
    host_round_trip(&HostMessage::AppResized {
        app_id: "term".into(),
        size: [800.0, 600.0],
    });
    host_round_trip(&HostMessage::AppClosed {
        app_id: "term".into(),
    });
    host_round_trip(&HostMessage::AppCursor {
        app_id: "term".into(),
        cursor: CursorShape::Text,
    });
}

/// The chrome assigns the cursor straight to CSS `cursor`, so every shape must
/// serialise to a valid CSS keyword.
#[test]
fn cursor_shapes_are_css_keywords() {
    let shape = |shape: CursorShape| serde_json::to_value(shape).unwrap();
    assert_eq!(shape(CursorShape::None), "none");
    assert_eq!(shape(CursorShape::Default), "default");
    assert_eq!(shape(CursorShape::Text), "text");
    assert_eq!(shape(CursorShape::NotAllowed), "not-allowed");
    assert_eq!(shape(CursorShape::NwseResize), "nwse-resize");
    assert_eq!(shape(CursorShape::ZoomIn), "zoom-in");
}

#[test]
fn the_desktop_is_described_to_the_chrome() {
    // Everything the chrome needs to lay a display out and address it. The
    // wire shape is pinned as well as round-tripped, because a shell reads
    // these field names directly.
    let displays = HostMessage::Displays {
        displays: vec![
            DisplayInfo {
                name: "left".into(),
                position: [0, 0],
                size: [1920, 1080],
                scale: 1,
            },
            DisplayInfo {
                name: "right".into(),
                position: [1920, 0],
                size: [2560, 1440],
                scale: 2,
            },
        ],
    };
    host_round_trip(&displays);

    let v = serde_json::to_value(displays).unwrap();
    assert_eq!(v["type"], "displays");
    assert_eq!(v["displays"][0]["name"], "left");
    assert_eq!(v["displays"][0]["position"], serde_json::json!([0, 0]));
    assert_eq!(v["displays"][1]["name"], "right");
    assert_eq!(v["displays"][1]["position"][0], 1920);
    assert_eq!(v["displays"][1]["size"][1], 1440);
    assert_eq!(v["displays"][1]["scale"], 2);
}

#[test]
fn a_desktop_of_no_displays_is_a_message_rather_than_a_silence() {
    // A desktop with no screens on it is an answer the chrome has to be able
    // to receive, not the absence of one. The compositor never sends it — it
    // describes at least one output, and the window-following case is a
    // display named `domicile-0` rather than an empty list — but a `Host`
    // nobody has described a desktop to does, and the `domicile` daemon is
    // one. "Told nothing" and "not told" are different states, and the shape
    // has to survive the wire for a chrome to tell them apart.
    // Asserted on the wire rather than through a round trip, which cannot see
    // the difference: an empty `Vec` that serialises to nothing at all and one
    // that serialises to `[]` both come back empty, and only the second is a
    // desktop the chrome can parse.
    let v = serde_json::to_value(HostMessage::Displays { displays: vec![] }).unwrap();
    assert_eq!(v["type"], "displays");
    assert_eq!(v["displays"], serde_json::json!([]));
}

#[test]
fn wire_shape_is_pinned() {
    // The JS client depends on these exact strings — lock them.
    // A size the client has not said is `null` on the wire rather than an
    // absent key, which is the shape the chrome's schema parses: it reads
    // `size` the way it already reads `title`, and both arrive as JSON null.
    let v = serde_json::to_value(HostMessage::AppAppeared {
        app_id: "term".into(),
        title: None,
        size: None,
    })
    .unwrap();
    assert!(v["size"].is_null());

    let v = serde_json::to_value(ChromeMessage::ResizeApp {
        app_id: "term".into(),
        size: [800.0, 600.0],
    })
    .unwrap();
    assert_eq!(v["type"], "resize_app");
    assert_eq!(v["size"][1], 600.0);

    let v = serde_json::to_value(HostMessage::AppCursor {
        app_id: "term".into(),
        cursor: CursorShape::Pointer,
    })
    .unwrap();
    assert_eq!(v["type"], "app_cursor");
    assert_eq!(v["cursor"], "pointer");
}

#[test]
fn version_negotiation_accepts_matching_version() {
    assert_eq!(negotiate(PROTOCOL_VERSION).unwrap(), PROTOCOL_VERSION);
}

#[test]
fn version_negotiation_rejects_mismatch() {
    assert!(negotiate(PROTOCOL_VERSION + 1).is_err());
}

/// `ROADMAP.md` states the version as a literal, and this pins it.
///
/// Nothing pinned it before, and the habit that produced is worth naming
/// without counting, since any count includes the commit doing the counting.
/// The line spent most of its life stale: it was caught up in batches long
/// after the fact, once by a commit that bumped no version at all, and bumps
/// that edited `ROADMAP.md` in the same breath still walked past it. So
/// "remember to update the roadmap" was never the missing habit — a number
/// written down in prose is a copy of the constant, and it belongs to the
/// crate that owns the constant.
#[test]
fn the_roadmap_states_the_version_this_build_speaks() {
    // The path climbs out of the crate, which the crate itself never does. A
    // test that reads a repo file is not the portable description of the
    // protocol that `lib.rs` is; it is the check that the repo's prose about
    // it is true, and there is nowhere else for that to live.
    let roadmap = include_str!("../../../ROADMAP.md");
    let stated: Vec<&str> = roadmap
        .match_indices("`PROTOCOL_VERSION = ")
        .map(|(at, _)| &roadmap[at..])
        .collect();

    // Every mention, not merely one that agrees: a roadmap that says 13 in one
    // place and 14 in another satisfies "contains the right number" and is
    // still wrong wherever a reader happens to look.
    assert_eq!(
        stated.len(),
        1,
        "ROADMAP.md states the protocol version {} times; it is one line",
        stated.len()
    );
    assert!(
        stated[0].starts_with(&format!("`PROTOCOL_VERSION = {PROTOCOL_VERSION}`")),
        "ROADMAP.md does not say `PROTOCOL_VERSION = {PROTOCOL_VERSION}`; a bump left it behind"
    );
}
