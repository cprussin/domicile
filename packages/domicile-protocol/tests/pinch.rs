use domicile_protocol::ChromeMessage;

#[test]
fn native_pinch_phases_round_trip_without_losing_client_metadata() {
    for frame in [
        serde_json::json!({
            "type": "pointer_pinch", "app_id": "browser", "phase": "begin",
            "device": 7, "time": 3_000_000_000_u32, "fingers": 3
        }),
        serde_json::json!({
            "type": "pointer_pinch", "app_id": "browser", "phase": "update",
            "device": 7, "time": 3_000_000_001_u32,
            "dx": 1.25, "dy": -2.5, "scale": 1.6, "rotation": -12.0
        }),
        serde_json::json!({
            "type": "pointer_pinch", "app_id": "browser", "phase": "end",
            "device": 7, "time": 3_000_000_002_u32, "canceled": true
        }),
    ] {
        let message: ChromeMessage = serde_json::from_value(frame.clone())
            .expect("the native pinch wire format is recognized");
        assert_eq!(serde_json::to_value(message).unwrap(), frame);
    }
}

#[test]
fn pinch_begin_requires_at_least_one_finger() {
    let frame = serde_json::json!({
        "type": "pointer_pinch", "app_id": "browser", "phase": "begin",
        "device": 7, "time": 0, "fingers": 0
    });
    assert!(
        serde_json::from_value::<ChromeMessage>(frame).is_err(),
        "a zero-finger begin cannot describe a native gesture"
    );
}
