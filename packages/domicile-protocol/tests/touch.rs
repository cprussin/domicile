use domicile_protocol::ChromeMessage;

#[test]
fn touch_steps_round_trip_with_unsigned_times() {
    for frame in [
        serde_json::json!({
            "type": "touch", "app_id": "browser", "phase": "down",
            "id": 4, "time": 3_000_000_000_u32, "x": 12.5, "y": 40.0
        }),
        serde_json::json!({
            "type": "touch", "app_id": "browser", "phase": "motion",
            "id": 4, "time": 3_000_000_001_u32, "x": 13.0, "y": 41.5
        }),
        serde_json::json!({
            "type": "touch", "app_id": "browser", "phase": "up",
            "id": 4, "time": 3_000_000_002_u32
        }),
        serde_json::json!({
            "type": "touch", "app_id": "browser", "phase": "cancel",
            "time": 3_000_000_003_u32
        }),
    ] {
        let message: ChromeMessage =
            serde_json::from_value(frame.clone()).expect("the touch wire format is recognized");
        assert_eq!(serde_json::to_value(message).unwrap(), frame);
    }
}

#[test]
fn a_touch_down_needs_a_place() {
    let frame = serde_json::json!({
        "type": "touch", "app_id": "browser", "phase": "down", "id": 1, "time": 0
    });
    assert!(
        serde_json::from_value::<ChromeMessage>(frame).is_err(),
        "a finger that comes down is somewhere"
    );
}
