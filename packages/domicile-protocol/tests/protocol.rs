//! Behaviour tests for `domicile-protocol`, written before the implementation.
//!
//! This crate defines the wire contract between the Rust host and the in-page
//! bridge client (JS). Two things matter and are tested here:
//!  1. Every message round-trips through JSON unchanged.
//!  2. The on-the-wire shape is stable (the JS side hard-codes these strings),
//!     so we pin the tag/field names explicitly.

use domicile_protocol::{negotiate, ChromeMessage, CursorShape, HostMessage, PROTOCOL_VERSION};

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
    })
    .unwrap();
    assert_eq!(v["type"], "place_portal");
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
}

#[test]
fn version_negotiation_accepts_matching_version() {
    assert_eq!(negotiate(PROTOCOL_VERSION).unwrap(), PROTOCOL_VERSION);
}

#[test]
fn version_negotiation_rejects_mismatch() {
    assert!(negotiate(PROTOCOL_VERSION + 1).is_err());
}
