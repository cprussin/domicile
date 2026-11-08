use domicile_protocol::ChromeMessage;

#[test]
fn swipe_and_hold_phases_round_trip() {
    for frame in [
        serde_json::json!({ "type": "pointer_swipe", "phase": "begin", "fingers": 3 }),
        serde_json::json!({ "type": "pointer_swipe", "phase": "update", "dx": 1.25, "dy": -2.5 }),
        serde_json::json!({ "type": "pointer_swipe", "phase": "end", "canceled": false }),
        serde_json::json!({ "type": "pointer_hold", "phase": "begin", "fingers": 4 }),
        serde_json::json!({ "type": "pointer_hold", "phase": "end", "canceled": true }),
    ] {
        let message: ChromeMessage = serde_json::from_value(frame.clone())
            .expect("the swipe and hold wire format is recognized");
        assert_eq!(serde_json::to_value(message).unwrap(), frame);
    }
}

#[test]
fn a_begin_needs_a_finger() {
    for kind in ["pointer_swipe", "pointer_hold"] {
        let frame = serde_json::json!({ "type": kind, "phase": "begin", "fingers": 0 });
        assert!(serde_json::from_value::<ChromeMessage>(frame).is_err());
    }
}

/// The browser writes whole numbers of a double as `1.0`.
#[test]
fn an_update_reads_doubles_the_browser_wrote() {
    let message: ChromeMessage =
        serde_json::from_str(r#"{"type":"pointer_swipe","phase":"update","dx":1.0,"dy":0.0}"#)
            .unwrap();
    assert!(matches!(
        message,
        ChromeMessage::PointerSwipe {
            swipe: domicile_protocol::swipe::Swipe::Update { dx, dy }
        } if dx == 1.0 && dy == 0.0
    ));
}
