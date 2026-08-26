//! Behaviour tests for `domicile-config`, written before the implementation.
//!
//! The load-bearing requirement is hot-reload safety: a bad edit to the config
//! file on disk must NEVER take down the compositor — the last known-good
//! config stays active and the error is surfaced.

use domicile_config::{Config, ConfigError, ConfigStore, DisplayConfig};

// ---- parsing & defaults ---------------------------------------------------

#[test]
fn empty_config_uses_defaults() {
    let cfg = Config::parse("{}").expect("an empty object should parse to defaults");
    assert_eq!(cfg.compositor.nested_size, (1280, 800));
}

#[test]
fn default_keymap_is_programmers_dvorak_with_caps_swapped() {
    let keyboard = Config::parse("{}").unwrap().input.keyboard;
    assert_eq!(keyboard.xkb_layout, "us");
    assert_eq!(keyboard.xkb_variant, "dvp");
    assert_eq!(keyboard.xkb_options, vec!["caps:swapescape".to_string()]);
    // Empty rules/model mean "whatever libxkbcommon defaults to".
    assert_eq!(keyboard.xkb_rules, "");
    assert_eq!(keyboard.xkb_model, "");
}

#[test]
fn parses_a_full_config() {
    let text = r#"{ "compositor": { "nested_size": [1920, 1080] } }"#;
    let cfg = Config::parse(text).expect("valid config should parse");
    assert_eq!(cfg.compositor.nested_size, (1920, 1080));
}

// ---- keyboard / keymap ------------------------------------------------------

#[test]
fn parses_keyboard_settings() {
    let text = r#"{
        "input": {
            "keyboard": {
                "xkb_rules": "evdev",
                "xkb_model": "pc105",
                "xkb_layout": "us,de",
                "xkb_variant": "dvp,",
                "xkb_options": ["caps:swapescape", "grp:alt_shift_toggle"]
            }
        }
    }"#;
    let keyboard = Config::parse(text)
        .expect("valid keyboard config should parse")
        .input
        .keyboard;
    assert_eq!(keyboard.xkb_rules, "evdev");
    assert_eq!(keyboard.xkb_model, "pc105");
    // Layout and variant are passed to xkb verbatim, so sway's comma-separated
    // multi-layout form works as-is.
    assert_eq!(keyboard.xkb_layout, "us,de");
    assert_eq!(keyboard.xkb_variant, "dvp,");
    assert_eq!(
        keyboard.xkb_options,
        vec![
            "caps:swapescape".to_string(),
            "grp:alt_shift_toggle".to_string()
        ]
    );
}

#[test]
fn joins_xkb_options_for_xkb() {
    let keyboard = Config::parse(
        r#"{
  "input": {
    "keyboard": {
      "xkb_options": [
        "caps:swapescape",
        "compose:ralt"
      ]
    }
  }
}"#,
    )
    .unwrap()
    .input
    .keyboard;
    assert_eq!(
        keyboard.xkb_options_string(),
        "caps:swapescape,compose:ralt"
    );
}

#[test]
fn empty_xkb_options_disable_every_option() {
    // An explicitly empty list means "no options", not "use xkb's defaults".
    let keyboard = Config::parse(
        r#"{
  "input": {
    "keyboard": {
      "xkb_options": []
    }
  }
}"#,
    )
    .unwrap()
    .input
    .keyboard;
    assert_eq!(keyboard.xkb_options_string(), "");
}

#[test]
fn rejects_empty_keyboard_layout() {
    let err = Config::parse(
        r#"{
  "input": {
    "keyboard": {
      "xkb_layout": ""
    }
  }
}"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_blank_keyboard_option() {
    // A stray comma in a hand-edited list would otherwise reach xkb as junk.
    let err = Config::parse(
        r#"{
  "input": {
    "keyboard": {
      "xkb_options": [
        "caps:swapescape",
        ""
      ]
    }
  }
}"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_invalid_syntax() {
    let err = Config::parse("{ this is not json").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

/// A key nothing reads is refused rather than ignored.
///
/// The one property the whole shell-to-compositor interface leans on: a shell
/// generates this file, so a key that does nothing is a bug in a program
/// rather than a typo at a prompt, and `@domicile/electron-chrome-host` says
/// so in as many words — its `parseDesktop` mirrors `deny_unknown_fields` with
/// `.strict()`, and its `configDocument` test reasons that what stays *out* of
/// an emitted section is a claim about that section. Nothing else here covers
/// it: the test that did went with `[shell]`.
#[test]
fn rejects_a_key_nothing_reads() {
    // Misspelt in a section that exists, which is the shape a real one takes.
    let err = Config::parse(r#"{ "compositor": { "nested_sixe": [800, 600] } }"#).unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
    assert!(
        format!("{err}").contains("nested_sixe"),
        "the message should name the key: {err}"
    );

    // And at the top level, where a whole section could be misspelt.
    let err = Config::parse(r#"{ "outputs": {} }"#).unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");

    // Every section that carries the attribute, not only the two above. The
    // ones a shell writes keys into are `output` and `input.keyboard`, and a
    // guard that covered `Config` and `CompositorConfig` alone would have let
    // a misspelt `xkb_optoins` through while reading as though it did not.
    for section in [
        r#"{ "input": { "keyboard": { "xkb_optoins": [] } } }"#,
        r#"{ "input": { "keyboardd": {} } }"#,
        r#"{ "output": { "max_scaale": 2 } }"#,
        r#"{ "output": { "displays": [{ "name": "a", "size": [1, 1], "scaale": 2 }] } }"#,
    ] {
        let err = Config::parse(section).unwrap_err();
        assert!(
            matches!(err, ConfigError::Parse(_)),
            "{section} should be refused, got {err:?}"
        );
    }
}

#[test]
fn rejects_zero_nested_size() {
    let err = Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      0,
      600
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

// ---- hot-reload semantics (the important part) ----------------------------

#[test]
fn store_reload_valid_swaps_current_and_clears_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str(
            r#"{
  "compositor": {
    "nested_size": [
      800,
      600
    ]
  }
}"#,
        )
        .unwrap();
    assert_eq!(store.current().compositor.nested_size, (800, 600));
    assert!(store.last_error().is_none());
}

#[test]
fn store_reload_invalid_keeps_last_good_and_records_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str(
            r#"{
  "compositor": {
    "nested_size": [
      800,
      600
    ]
  }
}"#,
        )
        .unwrap();

    // A subsequent bad edit must NOT change the live config.
    let err = store.reload_from_str("nested_size = = broken").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)));
    assert_eq!(
        store.current().compositor.nested_size,
        (800, 600),
        "last-good config must remain active after a bad edit"
    );
    assert!(store.last_error().is_some());
}

#[test]
fn store_recovers_after_fixing_a_bad_edit() {
    let mut store = ConfigStore::new(Config::default());
    let _ = store.reload_from_str("broken = = =");
    assert!(store.last_error().is_some());

    store
        .reload_from_str(
            r#"{
  "compositor": {
    "nested_size": [
      640,
      480
    ]
  }
}"#,
        )
        .unwrap();
    assert_eq!(store.current().compositor.nested_size, (640, 480));
    assert!(
        store.last_error().is_none(),
        "error must clear once config is valid again"
    );
}

// ---- filesystem loading ----------------------------------------------------

#[test]
fn loads_from_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.json");
    std::fs::write(
        &path,
        r#"{
  "compositor": {
    "nested_size": [
      1024,
      768
    ]
  }
}"#,
    )
    .unwrap();

    let cfg = Config::load(&path).unwrap();
    assert_eq!(cfg.compositor.nested_size, (1024, 768));
}

#[test]
fn missing_file_is_an_io_error() {
    let err = Config::load("/no/such/domicile.json").unwrap_err();
    assert!(matches!(err, ConfigError::Io { .. }), "got {err:?}");
}

#[test]
fn store_reload_from_path_keeps_last_good_on_bad_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.json");
    std::fs::write(
        &path,
        r#"{
  "compositor": {
    "nested_size": [
      1024,
      768
    ]
  }
}"#,
    )
    .unwrap();

    let mut store = ConfigStore::new(Config::load(&path).unwrap());
    assert_eq!(store.current().compositor.nested_size, (1024, 768));

    // Simulate a user saving a broken file.
    std::fs::write(&path, "nested_size = = nope").unwrap();
    assert!(store.reload_from_path(&path).is_err());
    assert_eq!(store.current().compositor.nested_size, (1024, 768));
}

// ---- output ---------------------------------------------------------------

#[test]
fn output_scaling_is_on_by_default_up_to_a_retina_display() {
    // A 2x display is the common case the default has to cover; beyond that a
    // frame costs more than the copy path can carry, so the default stops.
    assert_eq!(Config::parse("{}").unwrap().output.max_scale, 2);
}

#[test]
fn max_scale_one_turns_hidpi_off() {
    // The escape hatch: every pixel costs the readback, the socket and the IPC
    // hop squared, so a user who would rather have the latency than the
    // sharpness needs a way to say so without a rebuild.
    assert_eq!(
        Config::parse(
            r#"{
  "output": {
    "max_scale": 1
  }
}"#
        )
        .unwrap()
        .output
        .max_scale,
        1
    );
}

#[test]
fn max_scale_must_leave_a_usable_scale() {
    let err = Config::parse(
        r#"{
  "output": {
    "max_scale": 0
  }
}"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("output.max_scale"),
        "the message should name the setting: {err}"
    );
}

// ---- statically described displays -----------------------------------------

#[test]
fn no_displays_configured_means_the_output_follows_domiciles_window() {
    // The nested backend's original behaviour, and the only thing it can do
    // without being told: one output, sized by whatever window Domicile got.
    assert_eq!(Config::parse("{}").unwrap().output.displays, vec![]);
}

#[test]
fn parses_a_side_by_side_desktop() {
    let text = r#"{
        "output": {
            "displays": [
                { "name": "left", "position": [0, 0], "size": [1920, 1080] },
                { "name": "right", "position": [1920, 0], "size": [2560, 1440], "scale": 2 }
            ]
        }
    }"#;
    let displays = Config::parse(text)
        .expect("a described desktop should parse")
        .output
        .displays;
    assert_eq!(
        displays,
        vec![
            DisplayConfig {
                name: "left".into(),
                position: (0, 0),
                scale: 1,
                size: (1920, 1080),
            },
            DisplayConfig {
                name: "right".into(),
                position: (1920, 0),
                scale: 2,
                size: (2560, 1440),
            },
        ]
    );
}

#[test]
fn a_display_sits_at_the_origin_unless_placed() {
    // The one-display case, where there is nothing for a position to be
    // relative to.
    let displays = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "only",
        "size": [
          800,
          600
        ]
      }
    ]
  }
}"#,
    )
    .unwrap()
    .output
    .displays;
    assert_eq!(displays[0].position, (0, 0));
}

#[test]
fn a_display_needs_a_name_the_shell_can_tell_apart() {
    // The name is how the chrome addresses one window rather than another, so
    // two displays answering to it is not a preference the shell can resolve.
    let err = Config::parse(
        r#"{ "output": { "displays": [
            { "name": "hdmi", "size": [800, 600] },
            { "name": "hdmi", "position": [800, 0], "size": [800, 600] }
        ] } }"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a duplicate name should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("hdmi"),
        "the message should name the collision: {err}"
    );
}

#[test]
fn a_display_name_may_not_be_padded() {
    // `left ` and `left` are one display to a reader and two to an exact-match
    // lookup, and that lookup is how a chrome window says which display it is
    // — so the space presents as "this chrome claims a display that does not
    // exist" rather than as the typo it is. One entry, so what is pinned is
    // the rejection rather than "these two do not both parse", which a
    // trim-and-deduplicate would satisfy just as well.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "left ",
        "size": [
          800,
          600
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a padded name should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("padded"),
        "the message should say what is wrong with the name: {err}"
    );
}

#[test]
fn a_display_named_nothing_is_rejected() {
    // Reported by position: a display with no name has nothing else to be
    // called, and the entry still has to be findable in a file with five.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "real",
        "size": [
          800,
          600
        ]
      },
      {
        "name": "",
        "position": [
          800,
          0
        ],
        "size": [
          800,
          600
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a blank name should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("output.displays[1]"),
        "the message should say which entry: {err}"
    );
}

#[test]
fn a_display_with_no_pixels_is_rejected() {
    // Either axis: a display zero wide is as absent as one zero high.
    for size in ["[1920, 0]", "[0, 1080]"] {
        let err = Config::parse(&format!(
            r#"{{ "output": {{ "displays": [{{ "name": "dead", "size": {size} }}] }} }}"#
        ))
        .unwrap_err();
        assert!(
            matches!(err, ConfigError::Validation(_)),
            "size {size} should fail validation, not parsing: {err:?}"
        );
        assert!(
            format!("{err}").contains("dead"),
            "the message should name the display: {err}"
        );
    }
}

#[test]
fn a_display_must_have_a_usable_scale() {
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "tiny",
        "size": [
          800,
          600
        ],
        "scale": 0
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a zero scale should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("scale"),
        "the message should name the setting: {err}"
    );
}

#[test]
fn a_display_may_not_run_off_the_edge_of_the_desktop() {
    // Its far corner has to be a coordinate too. The desktop's bounding box is
    // computed from these, and an edge that is not representable is a layout
    // nothing downstream can size a window from — so it is rejected where it
    // is written rather than wrapping somewhere later.
    for position in ["[2147483000, 0]", "[0, 2147483000]"] {
        let err = Config::parse(&format!(
            r#"{{ "output": {{ "displays": [{{ "name": "far", "position": {position}, "size": [1920, 1080] }}] }} }}"#
        ))
        .unwrap_err();
        assert!(
            matches!(err, ConfigError::Validation(_)),
            "position {position} should fail validation, not parsing: {err:?}"
        );
        assert!(
            format!("{err}").contains("far"),
            "the message should name the display: {err}"
        );
    }
}

#[test]
fn displays_may_not_cover_the_same_ground() {
    // Two outputs over one region has no answer for which one a point belongs
    // to, so it is a typo in the layout rather than a desktop.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "left",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "right",
        "position": [
          1900,
          0
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an overlap should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("left") && message.contains("right"),
        "the message should name both displays: {err}"
    );
}

#[test]
fn displays_that_only_touch_are_a_desktop_rather_than_a_collision() {
    // The two ordinary layouts: the second display starts exactly where the
    // first ends, which is adjacency and not overlap, on each axis in turn.
    //
    // This pair is what holds the rectangle check honest. Each layout overlaps
    // fully on the axis it does not extend along, so a check that has dropped
    // either axis — or closed the interval — reports one of them as a
    // collision and fails here.
    Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "left",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "right",
        "position": [
          1920,
          0
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .expect("side-by-side displays should parse");
    Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "top",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "bottom",
        "position": [
          0,
          1080
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .expect("stacked displays should parse");
}

#[test]
fn a_desktop_may_reach_exactly_as_far_as_a_position_can_and_no_further() {
    // The boundary the check is written against, pinned because it is where a
    // future tightening would land: a far corner at exactly `i32::MAX`
    // normalises to a position of exactly `i32::MAX`, which is a position.
    //
    // Both axes, and each sized so that reading the *other* axis's length
    // would tip it over — which is the only way a test can tell a vertical
    // check that reads heights from one that reads widths.
    Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "here",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "far",
        "position": [
          2147479647,
          2000
        ],
        "size": [
          4000,
          8000
        ]
      }
    ]
  }
}"#,
    )
    .expect("a desktop exactly as wide as a position can describe should parse");
    // One pixel past it, which is what pins the display's *length* as part of
    // the reach. The near display sits at -1 so that the far one's own corner
    // still fits — otherwise the per-display check rejects this first and the
    // layout check is never asked. Without the length, the far position alone
    // is under the limit and this desktop is accepted.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "here",
        "position": [
          -1,
          0
        ],
        "size": [
          10,
          10
        ]
      },
      {
        "name": "far",
        "position": [
          2147479647,
          2000
        ],
        "size": [
          4000,
          8000
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("from here to far"),
        "the layout check should be the one that answers, not the per-display one: {err}"
    );
    Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "here",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "below",
        "position": [
          3000,
          2147482567
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .expect("a desktop exactly as tall as a position can describe should parse");
}

#[test]
fn the_desktop_must_fit_the_coordinate_space_on_both_axes() {
    // Stacked rather than side by side. The horizontal case cannot tell
    // whether the vertical one reads the right fields — or is checked at all.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "north",
        "position": [
          0,
          -2000000000
        ],
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "south",
        "position": [
          0,
          2000000000
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable desktop should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("from north to south") && message.contains("down"),
        "the message should name the outliers near-to-far, and the axis: {err}"
    );
}

#[test]
fn a_display_too_big_on_its_own_is_reported_as_itself() {
    // The specific diagnosis has to survive the layout-wide one: a single
    // display whose own far corner does not fit is an error about that
    // display, and "the displays span N across" names nobody and is not even
    // true of one.
    //
    // Sized so the *mode* check lets it through — a billion at scale 1 is a
    // representable mode — because that check runs first and would otherwise
    // answer for this one, leaving the branch this test is named after
    // reachable by nothing.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "huge",
        "position": [
          2000000000,
          0
        ],
        "size": [
          1000000000,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    let message = format!("{err}");
    assert!(
        message.contains("output.displays[0]") && message.contains("far corner"),
        "the message should name the display and its own far corner: {err}"
    );

    // And with a second display, which is the only arrangement where the
    // *order* of the two checks is observable: this layout spans too far and
    // `far`'s own corner overflows, so whichever check runs first decides the
    // message. Per-display first, because "from west to far across" is a fact
    // about the pair and names `west`, which is not the one at fault.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "west",
        "position": [
          -2000000000,
          0
        ],
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "far",
        "position": [
          2147483000,
          0
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    let message = format!("{err}");
    assert!(
        message.contains("far corner") && message.contains("far's"),
        "the display at fault should be named, not the pair: {err}"
    );
}

#[test]
fn the_desktop_as_a_whole_must_fit_the_coordinate_space() {
    // Each display's own far corner fitting is not enough: two that each fit
    // can still be four billion apart, and the desktop is placed about its own
    // top-left corner, so that span is what everything downstream is sized
    // and positioned in.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "west",
        "position": [
          -2000000000,
          0
        ],
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "east",
        "position": [
          2000000000,
          0
        ],
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable desktop should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("from west to east") && message.contains("across"),
        "the message should name the outliers near-to-far, and the axis: {err}"
    );
}

#[test]
fn a_displays_mode_must_fit_the_coordinate_space() {
    // The `wl_output` mode is physical pixels — the logical size times the
    // scale — so a size and a scale that each fit on their own can still
    // multiply past what a coordinate is. Rejected here rather than left to
    // overflow where the mode is computed, which is arithmetic in the Smithay
    // backend where nothing can test it.
    //
    // This is also what bounds the logical size on its own: the scale is at
    // least 1, so a mode that fits means a size that fits, which is the
    // invariant `Desktop` asserts when it normalises. There is no separate
    // size check to test — it was unreachable, and every input that would
    // have reached it arrives here instead.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "dense",
        "size": [
          1920,
          1080
        ],
        "scale": 2000000
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable mode should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("output.displays[0]") && message.contains("dense"),
        "the message should name the display: {err}"
    );
    // A display that does not fit is a fact about that display. The
    // layout-wide message compares two displays near-to-far, and with only
    // one of them it would say a display is that far from itself.
    assert!(
        !message.contains("dense and dense"),
        "one display cannot be a distance from itself: {err}"
    );

    // The boundary, exactly: `>` is the right comparison and a `>=` would
    // reject a legal desktop. `i32::MAX` is a Mersenne prime, so scale 1 is
    // the only way to land on it — at scale 2 the nearest mode below is one
    // short, which is why the earlier version of this case tested nothing.
    Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "exact",
        "size": [
          2147483647,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .expect("a mode exactly as wide as a coordinate should parse");
    Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "over",
        "size": [
          2147483648,
          1080
        ]
      }
    ]
  }
}"#,
    )
    .expect_err("one pixel more than a coordinate should not");

    // Each axis on its own, and each with the *other* axis comfortably inside
    // the bound: a case that trips both halves at once cannot tell whether
    // either is checked.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "wide",
        "size": [
          2147483647,
          1
        ],
        "scale": 2
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("wide"),
        "the width half is checked with a height that fits: {err}"
    );
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "tall",
        "size": [
          1,
          2147483647
        ],
        "scale": 2
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("tall"),
        "the height half is checked with a width that fits: {err}"
    );

    // The largest inputs the types allow. Written in `i64` this check panicked
    // on them in debug, which `ConfigStore` cannot have.
    //
    // Asserted on the *message*, not merely on `Validation(_)`: this display's
    // far corner is also off the coordinate space, so a version of the mode
    // check that wrapped would still be rejected here — by that check, with
    // that reason. Only naming the mode pins the mode check.
    let err = Config::parse(
        r#"{
  "output": {
    "displays": [
      {
        "name": "huge",
        "size": [
          4294967295,
          4294967295
        ],
        "scale": 4294967295
      }
    ]
  }
}"#,
    )
    .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("the biggest mode the types allow is rejected, not a panic or a wrap: {err:?}");
    };
    assert!(
        message.contains("a mode of"),
        "rejected for its mode rather than for its far corner: {message}"
    );
}

#[test]
fn the_nested_desktops_mode_must_fit_the_coordinate_space() {
    // The same arithmetic on the other path. With no displays described, the
    // desktop is `compositor.nested_size` and the scale climbs to
    // `output.max_scale` — so those two multiply into a mode exactly as the
    // described ones do, and the product has to be a coordinate.
    let err = Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      2000000000,
      800
    ]
  },
  "output": {
    "max_scale": 10
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable nested mode should fail validation: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("nested_size") && message.contains("max_scale"),
        "the message should name both settings, since neither is wrong alone: {err}"
    );

    // Either alone is fine, which is why the check is on the product. The cap
    // has to be stated: it defaults to 2, and this desktop does not fit twice.
    Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      2000000000,
      800
    ]
  },
  "output": {
    "max_scale": 1
  }
}"#,
    )
    .expect("a large desktop at scale 1 is representable");
    Config::parse(
        r#"{
  "output": {
    "max_scale": 10
  }
}"#,
    )
    .expect("a high cap on a small desktop is fine");

    // The boundary, exactly, and one past it.
    Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      2147483647,
      1
    ]
  },
  "output": {
    "max_scale": 1
  }
}"#,
    )
    .expect("a mode exactly as wide as a coordinate should parse");
    Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      2147483648,
      1
    ]
  },
  "output": {
    "max_scale": 1
  }
}"#,
    )
    .expect_err("one pixel more than a coordinate should not");

    // Each axis with the other comfortably inside the bound, so neither case
    // can pass on the strength of the half it is not about.
    let err = Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      2147483647,
      1
    ]
  },
  "output": {
    "max_scale": 2
  }
}"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("nested_size"),
        "the width half is checked with a height that fits: {err}"
    );
    let err = Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      1,
      2147483647
    ]
  },
  "output": {
    "max_scale": 2
  }
}"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("nested_size"),
        "the height half is checked with a width that fits: {err}"
    );

    // Rejected even when displays are described, where neither setting is
    // read: a config is checked for what it says, not for which of it this run
    // happens to use, so adding a display must not quietly legalise a nested
    // size that was rejected a moment ago. Scoping the check to the
    // no-displays case passes every other test here.
    Config::parse(
        r#"{
            "compositor": { "nested_size": [2000000000, 800] },
            "output": {
                "max_scale": 10,
                "displays": [{ "name": "only", "size": [1920, 1080] }]
            }
        }"#,
    )
    .expect_err("an unrepresentable nested mode is rejected whatever else is configured");

    // The largest inputs the types allow, which an `i64` product wrapped or
    // panicked on. A panic here would also break `ConfigStore`'s guarantee
    // that a bad config can never take the compositor down.
    let err = Config::parse(
        r#"{
  "compositor": {
    "nested_size": [
      4294967295,
      4294967295
    ]
  },
  "output": {
    "max_scale": 4294967295
  }
}"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "the biggest nested mode the types allow is rejected, not a panic or a wrap: {err:?}"
    );
}
