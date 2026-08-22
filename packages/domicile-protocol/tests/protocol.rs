//! Behaviour tests for `domicile-protocol`, written before the implementation.
//!
//! This crate defines the wire contract between the Rust host and the in-page
//! bridge client (JS). Two things matter and are tested here:
//!  1. Every message round-trips through JSON unchanged.
//!  2. The on-the-wire shape is stable (the JS side hard-codes these strings),
//!     so we pin the tag/field names explicitly.

use domicile_protocol::{
    negotiate, ChromeMessage, CursorShape, DisplayInfo, HostMessage, Shadow, PROTOCOL_VERSION,
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
    chrome_round_trip(&ChromeMessage::PlacePortal {
        app_id: "term".into(),
        transform: [2.0, 0.0, 0.0, 2.0, 50.0, 60.0],
        size: [640.0, 480.0],
        z_index: 3,
        visible: true,
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: Some(Shadow {
            dx: 4.0,
            dy: 8.0,
            blur: 12.0,
            spread: 2.0,
            color: [0.0, 0.0, 0.0, 0.5],
        }),
        native: true,
        takes_pointer: true,
    });
    chrome_round_trip(&ChromeMessage::RemovePortal {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::FocusApp {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::SetDevicePixelRatio { ratio: 1.5 });
    chrome_round_trip(&ChromeMessage::FocusChrome);
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
        size: [640.0, 480.0],
    });
    host_round_trip(&HostMessage::AppAppeared {
        app_id: "x".into(),
        title: None,
        size: [1.0, 1.0],
    });
    host_round_trip(&HostMessage::AppResized {
        app_id: "term".into(),
        size: [800.0, 600.0],
    });
    host_round_trip(&HostMessage::AppFrame {
        app_id: "term".into(),
        width: 2,
        height: 1,
        scale: 1,
        format: "rgba".into(),
        bytes: 8,
        region: Some([1, 2, 3, 4]),
    });
    host_round_trip(&HostMessage::AppClosed {
        app_id: "term".into(),
    });
    host_round_trip(&HostMessage::AppCursor {
        app_id: "term".into(),
        cursor: CursorShape::Text,
    });
    host_round_trip(&HostMessage::AppComposited {
        app_id: "term".into(),
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
    // The no-displays case — one output following Domicile's own window — is
    // an answer the chrome has to be able to receive, not the absence of one.
    // Asserted on the wire rather than through a round trip, which cannot see
    // the difference: an empty `Vec` that serialises to nothing at all and one
    // that serialises to `[]` both come back empty, and only the second is a
    // desktop the chrome can parse.
    let v = serde_json::to_value(HostMessage::Displays { displays: vec![] }).unwrap();
    assert_eq!(v["type"], "displays");
    assert_eq!(v["displays"], serde_json::json!([]));
}

#[test]
fn an_app_frame_without_a_region_is_the_whole_buffer() {
    // The field is what makes a partial frame legible, so a frame that does
    // not carry one has to mean all of it. Defaulting the other way would draw
    // every window from its own top-left corner outwards.
    let frame: HostMessage = serde_json::from_str(
        r#"{"type":"app_frame","app_id":"term","width":4,"height":3,
            "scale":1,"format":"rgba","bytes":48}"#,
    )
    .unwrap();
    let HostMessage::AppFrame { region, .. } = frame else {
        panic!("not an app_frame");
    };
    assert_eq!(region, None);
}

#[test]
fn a_place_portal_without_takes_pointer_takes_the_pointer() {
    // The default has to be the useful one: a chrome that does not send the
    // field is one from before there was anything to paint over a window, and
    // every window it places is meant to be clicked. Defaulting the other way
    // would make such a desktop's windows all inert at once.
    let placed: ChromeMessage = serde_json::from_str(
        r#"{"type":"place_portal","app_id":"term","transform":[1,0,0,1,0,0],
            "size":[10,20],"z_index":0,"visible":true}"#,
    )
    .unwrap();
    let ChromeMessage::PlacePortal { takes_pointer, .. } = placed else {
        panic!("not a place_portal");
    };
    assert!(takes_pointer);
}

#[test]
fn wire_shape_is_pinned() {
    // The JS bridge depends on these exact strings — lock them.
    let v = serde_json::to_value(ChromeMessage::PlacePortal {
        app_id: "term".into(),
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        size: [10.0, 20.0],
        z_index: 0,
        visible: true,
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: None,
        native: true,
        takes_pointer: true,
    })
    .unwrap();
    assert_eq!(v["type"], "place_portal");
    assert_eq!(v["takes_pointer"], true);
    assert_eq!(v["app_id"], "term");
    assert_eq!(v["z_index"], 0);
    assert_eq!(v["size"][0], 10.0);

    let v = serde_json::to_value(HostMessage::AppAppeared {
        app_id: "term".into(),
        title: None,
        size: [1.0, 1.0],
    })
    .unwrap();
    assert_eq!(v["type"], "app_appeared");

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

    let v = serde_json::to_value(HostMessage::AppComposited {
        app_id: "term".into(),
    })
    .unwrap();
    assert_eq!(v["type"], "app_composited");
    assert_eq!(v["app_id"], "term");
}

/// A chrome that says nothing about `native` gets the fast path.
///
/// The whole back-compat argument for the field rests on this default, and
/// nothing else exercises it: every fixture in the workspace fills the field
/// in, so making it required would turn every such line into a parse error —
/// a portal that simply never appears — without failing a test.
#[test]
fn a_placement_without_native_draws_the_clients_own_buffer() {
    let parsed: ChromeMessage = serde_json::from_str(
        r#"{"type":"place_portal","app_id":"term","transform":[1,0,0,1,0,0],
            "size":[10,20],"z_index":0,"visible":true}"#,
    )
    .expect("a placement from a chrome that has no opinion still parses");
    assert!(
        matches!(parsed, ChromeMessage::PlacePortal { native, .. } if native),
        "a chrome that cannot say is one from before there was anything the shaders could not draw"
    );
}

#[test]
fn version_negotiation_accepts_matching_version() {
    assert_eq!(negotiate(PROTOCOL_VERSION).unwrap(), PROTOCOL_VERSION);
}

#[test]
fn version_negotiation_rejects_mismatch() {
    assert!(negotiate(PROTOCOL_VERSION + 1).is_err());
}
