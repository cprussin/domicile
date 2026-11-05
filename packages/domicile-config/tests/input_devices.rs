//! Touchpad and mouse settings are validated at the config boundary.

use domicile_config::Config;
use serde_json::json;

#[test]
fn touchpads_and_mice_can_be_configured_independently() {
    let written = json!({
        "input": {
            "touchpad": {
                "tap": true,
                "tap_button_map": "lrm",
                "tap_drag": true,
                "drag_lock": false,
                "natural_scroll": true,
                "accel_profile": "adaptive",
                "speed": 0,
                "click_method": "clickfinger",
                "middle_emulation": false,
                "scroll_method": "two_finger",
                "scroll_factor": 1,
                "scroll_acceleration": false,
                "disable_while_typing": "internal",
                "typing_pause_ms": 200,
                "typing_repeat_pause_ms": 500
            },
            "mouse": {
                "accel_profile": "flat",
                "speed": -0.25,
                "natural_scroll": false,
                "middle_emulation": true,
                "scroll_factor": 1.5
            }
        }
    });
    let result = Config::parse(&written.to_string());
    assert!(result.is_ok(), "{result:?}");
}

#[test]
fn input_settings_refuse_unknown_keys_and_values() {
    for (section, field, value) in [
        ("touchpad", "tap_button_map", json!("rlm")),
        ("touchpad", "accel_profile", json!("custom")),
        ("touchpad", "click_method", json!("area")),
        ("touchpad", "scroll_method", json!("three_finger")),
        ("touchpad", "disable_while_typing", json!(true)),
        ("mouse", "accel_profile", json!("custom")),
        ("touchpad", "unknown", json!(true)),
        ("mouse", "unknown", json!(true)),
    ] {
        let result = Config::parse(&json!({"input": {section: {field: value}}}).to_string());
        assert!(result.is_err(), "{section}.{field} accepts {value}");
    }
}

#[test]
fn input_numbers_name_the_setting_when_out_of_range() {
    for section in ["touchpad", "mouse"] {
        for (field, value) in [
            ("speed", json!(-1.01)),
            ("speed", json!(1.01)),
            ("scroll_factor", json!(0)),
            ("scroll_factor", json!(-1)),
        ] {
            let error = Config::parse(&json!({"input": {section: {field: value}}}).to_string())
                .expect_err("out-of-range input settings are refused")
                .to_string();
            assert!(
                error.contains(&format!("input.{section}.{field}")),
                "{error}"
            );
        }
    }
}

#[test]
fn input_numbers_accept_limits_and_zero_typing_pauses() {
    for section in ["touchpad", "mouse"] {
        for speed in [-1.0, 1.0] {
            let result = Config::parse(
                &json!({"input": {section: {"speed": speed, "scroll_factor": 0.1}}}).to_string(),
            );
            assert!(result.is_ok(), "{result:?}");
        }
    }
    let result =
        Config::parse(r#"{"input":{"touchpad":{"typing_pause_ms":0,"typing_repeat_pause_ms":0}}}"#);
    assert!(result.is_ok(), "{result:?}");
}

#[test]
fn the_schema_describes_the_input_defaults_and_ranges() {
    let schema = serde_json::to_value(schemars::schema_for!(Config)).expect("a schema is JSON");
    let touchpad = &schema["$defs"]["TouchpadConfig"];
    let mouse = &schema["$defs"]["MouseConfig"];
    assert_eq!(touchpad["properties"]["tap"]["default"], json!(true));
    assert_eq!(
        touchpad["properties"]["natural_scroll"]["default"],
        json!(false)
    );
    assert_eq!(
        touchpad["properties"]["scroll_acceleration"]["default"],
        json!(true)
    );
    assert_eq!(
        touchpad["properties"]["typing_pause_ms"]["default"],
        json!(200)
    );
    assert_eq!(
        touchpad["properties"]["typing_repeat_pause_ms"]["default"],
        json!(500)
    );
    for settings in [touchpad, mouse] {
        assert_eq!(settings["properties"]["speed"]["minimum"], json!(-1.0));
        assert_eq!(settings["properties"]["speed"]["maximum"], json!(1.0));
        assert_eq!(
            settings["properties"]["scroll_factor"]["exclusiveMinimum"],
            json!(0.0)
        );
        assert_eq!(settings["additionalProperties"], json!(false));
    }
}

#[test]
fn typing_pauses_fit_the_engines_millisecond_integer() {
    for field in ["typing_pause_ms", "typing_repeat_pause_ms"] {
        let error =
            Config::parse(&json!({"input": {"touchpad": {field: 2147483648_u64}}}).to_string())
                .expect_err("the engine reads durations as signed 32-bit milliseconds")
                .to_string();
        assert!(
            error.contains(&format!("input.touchpad.{field}")),
            "{error}"
        );
    }
}

#[test]
fn omitted_input_settings_serialize_as_the_engine_defaults() {
    let config = Config::parse("{}").expect("the default desktop config");
    assert_eq!(
        serde_json::to_value(config.input.touchpad).expect("settings serialize"),
        json!({
            "tap": true,
            "tap_button_map": "lrm",
            "tap_drag": true,
            "drag_lock": false,
            "natural_scroll": false,
            "accel_profile": "adaptive",
            "speed": 0.0,
            "click_method": "default",
            "middle_emulation": false,
            "scroll_method": "default",
            "scroll_factor": 1.0,
            "scroll_acceleration": true,
            "disable_while_typing": "enabled",
            "typing_pause_ms": 200,
            "typing_repeat_pause_ms": 500
        })
    );
    assert_eq!(
        serde_json::to_value(config.input.mouse).expect("settings serialize"),
        json!({
            "accel_profile": "adaptive",
            "speed": 0.0,
            "natural_scroll": false,
            "middle_emulation": false,
            "scroll_factor": 1.0
        })
    );
}

#[test]
fn native_typing_uses_libinput_and_its_default_timers() {
    for settings in [
        json!({"disable_while_typing": "libinput"}),
        json!({"disable_while_typing": "libinput", "typing_pause_ms": 200, "typing_repeat_pause_ms": 500}),
    ] {
        let config = Config::parse(&json!({"input": {"touchpad": settings}}).to_string())
            .expect("native typing uses libinput with default timing fields");
        let written = serde_json::to_value(config.input.touchpad).unwrap();
        assert_eq!(written["disable_while_typing"], json!("libinput"));
        assert_eq!(written["typing_pause_ms"], json!(200));
        assert_eq!(written["typing_repeat_pause_ms"], json!(500));
    }
}

#[test]
fn native_typing_rejects_custom_guard_pauses() {
    for (field, value) in [
        ("typing_pause_ms", 0),
        ("typing_pause_ms", 201),
        ("typing_repeat_pause_ms", 0),
        ("typing_repeat_pause_ms", 501),
    ] {
        let error = Config::parse(
            &json!({"input": {"touchpad": {
                "disable_while_typing": "libinput", field: value
            }}})
            .to_string(),
        )
        .expect_err("native libinput timers cannot be configured")
        .to_string();
        assert!(
            error.contains(&format!("input.touchpad.{field}")),
            "{error}"
        );
        assert!(error.contains("libinput"), "{error}");
    }
}
