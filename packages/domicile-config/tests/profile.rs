//! Behavior tests for the layout a profile makes of the monitors that are
//! plugged in, written before the implementation.
//!
//! The difference from `desktop.rs` is where the sizes come from. A described
//! desktop states its own — it is a nested compositor's arithmetic, and no
//! hardware is consulted. A profile states a *placement* and the monitors
//! state their modes, so the same config yields a different desktop as
//! monitors come and go. That is the whole point of it: the config is matched
//! against what is connected and applied again on every hotplug.

use domicile_config::{Config, Connected, Layout, Transform};

/// The layout `text`'s profiles make of `connected`, or a panic naming which
/// of the two ways it failed to produce one.
fn layout(text: &str, connected: &[Connected]) -> Layout {
    Config::parse(text)
        .expect("the config should parse")
        .output
        .layout(connected)
        .expect("the layout should be representable")
        .expect("a profile should match")
}

/// One monitor as the compositor found it: what it is called and the mode it
/// is running.
fn connected(name: &str, mode: (u32, u32)) -> Connected {
    Connected {
        name: name.to_owned(),
        mode,
    }
}

/// The laptop panel and the three identical monitors on the desk, in the shape
/// the home office profiles below place them.
const LAPTOP: &str = "drm-1";
const LEFT: &str = "drm-2";
const CENTER: &str = "drm-3";
const RIGHT: &str = "drm-4";

/// 2880x1920 at scale 1.5 is 1920x1280 logical; 3840x2160 at 1.2 is 3200x1800,
/// and 1800x3200 once it is stood on its side.
const PANEL_MODE: (u32, u32) = (2880, 1920);
const DESK_MODE: (u32, u32) = (3840, 2160);

#[test]
fn no_profiles_configured_is_no_layout() {
    // Not an empty one, and not a desktop of no screens: a config that says
    // nothing about placement leaves the monitors where the engine put them,
    // which is the behavior that existed before profiles did.
    assert!(
        Config::parse("{}")
            .unwrap()
            .output
            .layout(&[connected(LAPTOP, PANEL_MODE)])
            .unwrap()
            .is_none(),
        "a config with no profiles places nothing"
    );
}

#[test]
fn a_profile_applies_only_to_the_exact_set_of_displays_it_names() {
    // Both halves, because either one alone is a profile that fires on the
    // wrong desk. A profile whose displays are merely *present* would apply
    // the two-monitor layout with a third monitor plugged in and leave it
    // dark; one that merely overlaps would apply the three-monitor layout to
    // two and place a window on a screen that is not there.
    //
    // One profile in the config, so that what is asserted is this profile's
    // own matching rather than a second one further down the list catching
    // the sets it turns away.
    let config = Config::parse(ONE_DESK).expect("the config should parse");
    let matched = |connected: &[Connected]| {
        config
            .output
            .layout(connected)
            .expect("the layout should be representable")
            .is_some()
    };
    assert!(
        matched(&[connected(LAPTOP, PANEL_MODE), connected(CENTER, DESK_MODE)]),
        "the set the profile names is the set it applies to"
    );
    assert!(
        !matched(&[connected(LAPTOP, PANEL_MODE)]),
        "a display the profile names is not connected"
    );
    assert!(
        !matched(&[
            connected(LAPTOP, PANEL_MODE),
            connected(CENTER, DESK_MODE),
            connected(RIGHT, DESK_MODE),
        ]),
        "a display is connected that the profile does not name"
    );
}

#[test]
fn the_first_profile_that_matches_is_the_one_that_applies() {
    // Order is the tie-break and nothing else is: two profiles can name the
    // same set, and a desk with a "work" and a "play" arrangement of the same
    // monitors is the ordinary reason to write them.
    let layout = layout(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "first",
        "displays": [
          {
            "display": "drm-1"
          }
        ]
      },
      {
        "name": "second",
        "displays": [
          {
            "display": "drm-1"
          }
        ]
      }
    ]
  }
}"#,
        &[connected(LAPTOP, PANEL_MODE)],
    );
    assert_eq!(layout.profile(), "first");
}

#[test]
fn a_scale_divides_the_mode_into_the_logical_size() {
    // The mode is the panel's and the logical size is what the desktop is laid
    // out in, so a scale is the ratio between them — 1.5 on a 2880x1920 panel
    // is the 1920x1280 desktop this laptop is actually used at. Fractional
    // because every scale on this desk is: an integer-only scale would round
    // 1.5 to 2 and halve the usable desktop.
    let layout = layout(ONE_PANEL, &[connected(LAPTOP, PANEL_MODE)]);
    let placed = layout.placed().next().expect("the panel should be placed");
    assert_eq!(placed.logical, (1920, 1280));
    assert_eq!(placed.mode, PANEL_MODE, "the panel's own mode is carried");
    assert_eq!(placed.scale, 1.5);
}

#[test]
fn a_quarter_turn_swaps_a_displays_axes() {
    // The mode is what the connector scans out and does not turn with the
    // monitor; the logical size is what the desktop is laid out in and does.
    // Applied before the scale so that a rotated 3840x2160 at 1.2 is 1800x3200
    // rather than 3200x1800 relabelled — the desk below stands three monitors
    // on their sides and steps across them by 1800.
    let layout = layout(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "sideways",
        "displays": [
          {
            "display": "drm-3",
            "scale": 1.2,
            "transform": "rotate-270"
          }
        ]
      }
    ]
  }
}"#,
        &[connected(CENTER, DESK_MODE)],
    );
    let placed = layout
        .placed()
        .next()
        .expect("the monitor should be placed");
    assert_eq!(placed.logical, (1800, 3200));
    assert_eq!(
        placed.mode, DESK_MODE,
        "the connector still scans out 3840x2160"
    );
    assert_eq!(placed.transform, Transform::Rotate270);
    assert_eq!(layout.size(), (1800, 3200));
}

#[test]
fn a_disabled_display_has_to_be_connected_and_is_not_on_the_desktop() {
    // Both halves of what `status = "disable"` means, and they pull opposite
    // ways. The laptop panel is named so that closing the lid on a full desk
    // is a *match* — the profile below is the one that applies when all four
    // are plugged in — and it is disabled so that no window lands on a panel
    // nobody can see.
    let layout = layout(
        HOME_OFFICE_FULL,
        &[
            connected(LAPTOP, PANEL_MODE),
            connected(LEFT, DESK_MODE),
            connected(CENTER, DESK_MODE),
            connected(RIGHT, DESK_MODE),
        ],
    );
    assert_eq!(
        layout.placed().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        vec![LEFT, CENTER, RIGHT],
        "the disabled panel is matched on and then left off"
    );
    // Three monitors on their sides, stepped across by the 1800 each is wide
    // once turned.
    assert_eq!(
        layout.placed().map(|p| p.position).collect::<Vec<_>>(),
        vec![(0, 0), (1800, 0), (3600, 0)]
    );
    assert_eq!(layout.size(), (5400, 3200));
}

#[test]
fn a_layout_is_placed_about_its_own_top_left_corner() {
    // "Above and to the left of that one" is how a second monitor is
    // described, so negative coordinates are the natural way to write one —
    // and the desktop the chrome lays out in starts at zero. The same
    // normalization `Desktop` does for a described desktop, for the same
    // reason, and it has to happen here too because a profile's origin moves
    // as monitors come and go.
    let layout = layout(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "above-and-left",
        "displays": [
          {
            "display": "drm-1",
            "position": [
              -1920,
              -1080
            ],
            "scale": 1.5
          },
          {
            "display": "drm-3",
            "position": [
              0,
              0
            ],
            "scale": 1.2
          }
        ]
      }
    ]
  }
}"#,
        &[connected(LAPTOP, PANEL_MODE), connected(CENTER, DESK_MODE)],
    );
    assert_eq!(
        layout.placed().map(|p| p.position).collect::<Vec<_>>(),
        vec![(0, 0), (1920, 1080)]
    );
    // The box the two reach together, gap included: 1920 + 3200 across, and
    // 1080 + 1800 down, which is further than either display's own corner.
    assert_eq!(layout.size(), (5120, 2880));
}

#[test]
fn a_gap_between_two_placed_displays_is_part_of_the_desktop() {
    // The page spans the hole, exactly as it does for a described desktop, so
    // the box is what the displays reach rather than what they cover.
    let layout = layout(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "apart",
        "displays": [
          {
            "display": "drm-1",
            "scale": 1.5
          },
          {
            "display": "drm-3",
            "position": [
              4000,
              0
            ],
            "scale": 1.2
          }
        ]
      }
    ]
  }
}"#,
        &[connected(LAPTOP, PANEL_MODE), connected(CENTER, DESK_MODE)],
    );
    assert_eq!(layout.size(), (7200, 1800));
}

#[test]
fn a_layout_that_does_not_fit_the_coordinate_space_is_refused_rather_than_wrapped() {
    // The one failure a profile can have that parsing cannot catch: the
    // positions are the config's and the sizes are the hardware's, so how far
    // apart two displays end up is not known until a monitor is plugged in.
    // An error rather than a panic, because the caller is a compositor holding
    // a working desktop and a config the user can edit again.
    let refused = Config::parse(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "unreachable",
        "displays": [
          {
            "display": "drm-1"
          },
          {
            "display": "drm-3",
            "position": [
              2147483647,
              0
            ]
          }
        ]
      }
    ]
  }
}"#,
    )
    .expect("the config should parse")
    .output
    .layout(&[connected(LAPTOP, PANEL_MODE), connected(CENTER, DESK_MODE)])
    .expect_err("a desktop no coordinate can describe is refused");
    let said = refused.to_string();
    assert!(
        said.contains("unreachable") && said.contains("drm-3"),
        "the complaint should name the profile and the display: {said}"
    );
}

#[test]
fn rejects_a_profile_that_would_leave_the_desktop_empty() {
    // Every display disabled is not a smaller desktop, it is no desktop: every
    // window lands off it and nothing says why. Caught at parse time, where
    // the config can still be fixed, rather than on the hotplug that applies
    // it.
    let err = Config::parse(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "lid-shut",
        "displays": [
          {
            "display": "drm-1",
            "enabled": false
          }
        ]
      }
    ]
  }
}"#,
    )
    .expect_err("a profile that enables nothing is refused");
    assert!(
        err.to_string().contains("lid-shut"),
        "the complaint should name the profile: {err}"
    );
}

#[test]
fn rejects_a_profile_that_cannot_be_applied_as_written() {
    // Each of these is a config that parses as JSON and describes no layout.
    // Grouped rather than written out one per test because the assertion is
    // the same in every case — that the config is refused at parse time, when
    // the user is still looking at it.
    for text in [
        // A profile with no displays matches only a machine with no monitors,
        // which `DrmScreen` never reports.
        r#"{ "output": { "profiles": [{ "name": "empty", "displays": [] }] } }"#,
        // Two entries for one display: which of the two places it?
        r#"{ "output": { "profiles": [{ "name": "twice", "displays": [
             { "display": "drm-1" }, { "display": "drm-1" }] }] } }"#,
        // Two profiles with one name: the log line that says which applied
        // would name both.
        r#"{ "output": { "profiles": [
             { "name": "desk", "displays": [{ "display": "drm-1" }] },
             { "name": "desk", "displays": [{ "display": "drm-3" }] }] } }"#,
        // A profile with no name, which is the name the log line has to print.
        r#"{ "output": { "profiles": [{ "name": "", "displays": [{ "display": "drm-1" }] }] } }"#,
        // An unnamed display matches nothing, so the profile never applies.
        r#"{ "output": { "profiles": [{ "name": "anon", "displays": [{ "display": "" }] }] } }"#,
        // A scale of zero divides the mode into a desktop of no size; a
        // negative one turns it inside out; neither is a density.
        r#"{ "output": { "profiles": [{ "name": "flat", "displays": [
             { "display": "drm-1", "scale": 0 }] }] } }"#,
        r#"{ "output": { "profiles": [{ "name": "inside-out", "displays": [
             { "display": "drm-1", "scale": -1.5 }] }] } }"#,
        // A transform nothing can apply.
        r#"{ "output": { "profiles": [{ "name": "sideways", "displays": [
             { "display": "drm-1", "transform": "rotate-45" }] }] } }"#,
        // A field nobody reads, which is a typo in one that is read.
        r#"{ "output": { "profiles": [{ "name": "typo", "displays": [
             { "display": "drm-1", "scaale": 1.5 }] }] } }"#,
    ] {
        assert!(
            Config::parse(text).is_err(),
            "should have been refused: {text}"
        );
    }
}

#[test]
fn a_scale_that_leaves_a_monitor_no_logical_pixels_is_refused() {
    // The other failure that waits for the hardware. How large a scale is too
    // large depends on the mode, and the mode arrives with the monitor — so a
    // scale is checked for being a number at parse time and for being a
    // number *this panel* can carry here. Refused rather than floored at one
    // pixel: a display one pixel across is a screen every window misses.
    let refused = Config::parse(
        r#"{
  "output": {
    "profiles": [
      {
        "name": "vanishing",
        "displays": [
          {
            "display": "drm-1",
            "scale": 1e308
          }
        ]
      }
    ]
  }
}"#,
    )
    .expect("the config should parse")
    .output
    .layout(&[connected(LAPTOP, PANEL_MODE)])
    .expect_err("a display scaled out of existence is refused");
    let said = refused.to_string();
    assert!(
        said.contains("vanishing") && said.contains("drm-1"),
        "the complaint should name the profile and the display: {said}"
    );
}

#[test]
fn a_profile_is_matched_again_on_every_reading_of_the_monitors() {
    // The requirement the whole mechanism exists for. The same config answers
    // differently as monitors come and go, because matching is a function of
    // what is connected rather than something decided once at startup — so
    // unplugging the desk is the laptop-only layout without anything being
    // reloaded or restarted.
    let config = Config::parse(TWO_MONITORS).expect("the config should parse");
    let applied = |connected: &[Connected]| {
        config
            .output
            .layout(connected)
            .expect("the layout should be representable")
            .map(|layout| (layout.profile().to_owned(), layout.size()))
    };
    assert_eq!(
        applied(&[connected(LAPTOP, PANEL_MODE), connected(CENTER, DESK_MODE)]),
        Some(("home-office-center".to_owned(), (3200, 3080)))
    );
    assert_eq!(
        applied(&[connected(LAPTOP, PANEL_MODE)]),
        Some(("laptop-only".to_owned(), (1920, 1280)))
    );
}

/// The desk with one monitor on it and nothing beneath it, so that a set it
/// turns away has no second profile to fall through to.
const ONE_DESK: &str = r#"{
  "output": {
    "profiles": [
      {
        "name": "home-office-center",
        "displays": [
          {
            "display": "drm-1",
            "position": [
              640,
              1800
            ],
            "scale": 1.5
          },
          {
            "display": "drm-3",
            "position": [
              0,
              0
            ],
            "scale": 1.2
          }
        ]
      }
    ]
  }
}"#;

/// One display, scaled and nothing else — the laptop with its lid open and
/// nothing plugged in.
const ONE_PANEL: &str = r#"{
  "output": {
    "profiles": [
      {
        "name": "laptop-only",
        "displays": [
          {
            "display": "drm-1",
            "scale": 1.5
          }
        ]
      }
    ]
  }
}"#;

/// The desk with one monitor on it, and the laptop-only profile beneath it, so
/// that one config answers for both.
///
/// The panel is centered under the monitor: 1920 logical wide against 3200, so
/// (3200 - 1920) / 2 = 640 across, and 1800 down, which is the monitor's own
/// logical height.
const TWO_MONITORS: &str = r#"{
  "output": {
    "profiles": [
      {
        "name": "home-office-center",
        "displays": [
          {
            "display": "drm-1",
            "position": [
              640,
              1800
            ],
            "scale": 1.5
          },
          {
            "display": "drm-3",
            "position": [
              0,
              0
            ],
            "scale": 1.2
          }
        ]
      },
      {
        "name": "laptop-only",
        "displays": [
          {
            "display": "drm-1",
            "scale": 1.5
          }
        ]
      }
    ]
  }
}"#;

/// The full desk: three monitors on their sides and the laptop panel dark.
const HOME_OFFICE_FULL: &str = r#"{
  "output": {
    "profiles": [
      {
        "name": "home-office-full",
        "displays": [
          {
            "display": "drm-1",
            "enabled": false
          },
          {
            "display": "drm-2",
            "position": [
              0,
              0
            ],
            "scale": 1.2,
            "transform": "rotate-270"
          },
          {
            "display": "drm-3",
            "position": [
              1800,
              0
            ],
            "scale": 1.2,
            "transform": "rotate-270"
          },
          {
            "display": "drm-4",
            "position": [
              3600,
              0
            ],
            "scale": 1.2,
            "transform": "rotate-270"
          }
        ]
      }
    ]
  }
}"#;
