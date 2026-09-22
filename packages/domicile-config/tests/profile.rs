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

/// One monitor as the compositor found it, named only by its output name --
/// the case where the engine had no EDID to build a description out of.
fn connected(name: &str, mode: (u32, u32)) -> Connected {
    described(name, "", mode)
}

/// One monitor named by its output and by its panel, on a machine with no
/// `pnp.ids` to spell the vendor out of the panel's three-letter id.
fn described(name: &str, description: &str, mode: (u32, u32)) -> Connected {
    spelled_out(name, description, "", mode)
}

/// One monitor with every name it answers to: the output's, the panel's own
/// off its EDID, and that one again with the vendor spelled out.
fn spelled_out(name: &str, description: &str, spelled_out: &str, mode: (u32, u32)) -> Connected {
    Connected {
        name: name.to_owned(),
        description: description.to_owned(),
        spelled_out: spelled_out.to_owned(),
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
        Config::parse("")
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
fn a_profile_can_name_a_monitor_by_its_panel_rather_than_its_output() {
    // The point of carrying a description at all. `drm-3` is an int64 off an
    // EDID: stable, unique, and impossible to predict from looking at a desk.
    // The panel's own name is what a person can write down, and it is the
    // string kanshi and sway already match on.
    let layout = layout(
        r#"
[[output.profiles]]
name = "desk"
[[output.profiles.displays]]
display = "DEL DELL U3219Q G3MS413"
scale = 1.2
transform = "rotate-270"
"#,
        &[described(CENTER, "DEL DELL U3219Q G3MS413", DESK_MODE)],
    );
    let placed = layout
        .placed()
        .next()
        .expect("the monitor should be placed");
    assert_eq!(
        placed.name, CENTER,
        "the output keeps the name its clients are on; the panel's name is how it was found"
    );
    assert_eq!(placed.logical, (1800, 3200));
}

#[test]
fn a_profile_may_name_a_monitor_by_the_vendor_spelled_out() {
    // What sway and kanshi print, because they read hwdata's `pnp.ids` and an
    // EDID does not carry it: `Dell Inc.` where the firmware says `DEL`. A
    // desk written down off a running sway is written down in these words.
    assert!(
        the_desk_profile_matches("Dell Inc. DELL U3219Q G3MS413"),
        "a profile naming the vendor the way hwdata spells it should match"
    );
}

#[test]
fn a_profile_written_before_the_vendor_was_spelled_out_goes_on_matching() {
    // The reason both spellings match rather than the better one replacing
    // the other. Every config naming a monitor was written against the three
    // letters, and a desk that came up right yesterday comes up right today.
    assert!(
        the_desk_profile_matches("DEL DELL U3219Q G3MS413"),
        "the three letters an EDID states are still one of the names it answers to"
    );
}

/// Whether the desk profile matches a monitor answering to both spellings of
/// its panel's name when the profile writes it `display`.
fn the_desk_profile_matches(display: &str) -> bool {
    Config::parse(&format!(
        r#"
[[output.profiles]]
name = "desk"
[[output.profiles.displays]]
display = "{display}"
"#
    ))
    .expect("the config should parse")
    .output
    .layout(&[spelled_out(
        CENTER,
        "DEL DELL U3219Q G3MS413",
        "Dell Inc. DELL U3219Q G3MS413",
        DESK_MODE,
    )])
    .expect("the layout should be representable")
    .is_some()
}

#[test]
fn a_scale_of_exactly_one_may_be_written_as_an_integer() {
    // TOML tells `1` from `1.0` where JSON did not, and an unscaled monitor
    // is the commonest thing anybody configures -- so `scale = 1` is what
    // gets typed, and a format that refused it would refuse the easy case
    // first. Serde takes an integer into an `f64`; this is that stated rather
    // than read out of the deserializer, because it is a property of the
    // format change and not of this crate.
    let layout = layout(
        r#"
[[output.profiles]]
name = "desk"
[[output.profiles.displays]]
display = "drm-3"
scale = 1
"#,
        &[connected(CENTER, DESK_MODE)],
    );
    assert_eq!(
        layout
            .placed()
            .next()
            .expect("the monitor should be placed")
            .logical,
        DESK_MODE,
        "scale 1 is the mode itself"
    );
}

#[test]
fn a_profile_may_name_some_monitors_by_panel_and_others_by_output() {
    // A desk part-way through being written down: the monitor whose name has
    // been read off a running desktop, and the laptop panel that reports no
    // EDID name at all and can only be named by its output.
    let layout = layout(
        r#"
[[output.profiles]]
name = "half-named"
[[output.profiles.displays]]
display = "DEL DELL U3219Q G3MS413"
position = [0, 0]
scale = 1.2

[[output.profiles.displays]]
display = "drm-1"
position = [640, 1800]
scale = 1.5
"#,
        &[
            described(CENTER, "DEL DELL U3219Q G3MS413", DESK_MODE),
            connected(LAPTOP, PANEL_MODE),
        ],
    );
    assert_eq!(
        layout.placed().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        vec![CENTER, LAPTOP]
    );
    assert_eq!(layout.size(), (3200, 3080));
}

#[test]
fn two_entries_naming_one_monitor_two_ways_is_not_a_match() {
    // The hole that opens as soon as a display answers to two names: a profile
    // naming the same monitor by its output AND by its panel has as many
    // entries as there are monitors, and every entry finds one -- so counting
    // says the set matches when a whole monitor is unaccounted for. It would
    // apply the two-monitor layout with one screen left dark.
    let config = Config::parse(
        r#"
[[output.profiles]]
name = "twice-over"
[[output.profiles.displays]]
display = "drm-3"

[[output.profiles.displays]]
display = "DEL DELL U3219Q G3MS413"
"#,
    )
    .expect("the config should parse");
    assert!(
        config
            .output
            .layout(&[
                described(CENTER, "DEL DELL U3219Q G3MS413", DESK_MODE),
                connected(LAPTOP, PANEL_MODE),
            ])
            .expect("a profile that does not match cannot fail to apply")
            .is_none(),
        "two entries resolving to one monitor leaves the other unnamed"
    );
}

#[test]
fn a_monitor_that_reports_no_panel_name_is_not_matched_by_an_empty_one() {
    // Every display with no EDID name shares the same empty description, so a
    // description is only an identity when there is one. `display` cannot be
    // empty -- the config refuses that -- and this is the other half of it.
    let config = Config::parse(
        r#"
[[output.profiles]]
name = "anon"
[[output.profiles.displays]]
display = "drm-1"
"#,
    )
    .expect("the config should parse");
    assert!(
        config
            .output
            .layout(&[connected(LAPTOP, PANEL_MODE)])
            .expect("applicable")
            .is_some(),
        "a monitor with no panel name is still matched by its output name"
    );
}

#[test]
fn the_first_profile_that_matches_is_the_one_that_applies() {
    // Order is the tie-break and nothing else is: two profiles can name the
    // same set, and a desk with a "work" and a "play" arrangement of the same
    // monitors is the ordinary reason to write them.
    let layout = layout(
        r#"
[[output.profiles]]
name = "first"
[[output.profiles.displays]]
display = "drm-1"


[[output.profiles]]
name = "second"
[[output.profiles.displays]]
display = "drm-1"
"#,
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
    // rather than 3200x1800 relabeled — the desk below stands three monitors
    // on their sides and steps across them by 1800.
    let layout = layout(
        r#"
[[output.profiles]]
name = "sideways"
[[output.profiles.displays]]
display = "drm-3"
scale = 1.2
transform = "rotate-270"
"#,
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
fn a_disabled_display_is_a_connector_to_leave_dark() {
    // The other half of `enabled: false`, and the half the desktop cannot
    // carry: `placed` drops a disabled display, so what is left of it is a
    // name and an instruction. Without this the engine goes on lighting a
    // panel the profile turned off -- it lights every connector that reports
    // a mode -- and the lid comes down on a screen that is still on.
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
        layout
            .scanout()
            .iter()
            .map(|display| (display.name.as_str(), display.enabled, display.origin))
            .collect::<Vec<_>>(),
        vec![
            // The dark panel is named so it can be turned off -- and given a
            // corner anyway, past the three that are lit. The engine's display
            // list carries a dark connector as much as a lit one, and two
            // displays claiming one rectangle is worse than one that is off.
            (LAPTOP, false, (11520, 0)),
            (LEFT, true, (0, 0)),
            (CENTER, true, (3840, 0)),
            (RIGHT, true, (7680, 0)),
        ],
        "the three lit ones are stepped across by the mode each of them scans \
         out, and the dark one is put past the end of them"
    );
}

#[test]
fn the_connectors_are_stepped_across_in_the_order_the_profile_places_them() {
    // NOT the order the entries are written in, and not the order the engine
    // reported them: the order they are placed left to right. The engine's own
    // arrangement is connector order, which is the card's business and has
    // nothing to do with which monitor is on which side of the desk -- so a
    // pointer leaving one screen arrives on whichever the card happened to
    // enumerate next.
    //
    // The mode rather than the logical size, because this is the engine's
    // desktop: what a connector scans out is what it occupies there, whatever
    // the scale divides it into on ours.
    let layout = layout(
        CROSSED_DESK,
        &[connected(LEFT, DESK_MODE), connected(CENTER, PANEL_MODE)],
    );
    assert_eq!(
        layout
            .scanout()
            .iter()
            .map(|display| (display.name.as_str(), display.origin))
            .collect::<Vec<_>>(),
        vec![(LEFT, (2880, 0)), (CENTER, (0, 0))],
        "written first and placed second: the monitor the profile puts on the \
         left takes the origin, and the one beside it starts where that one's \
         mode ends"
    );
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
        r#"
[[output.profiles]]
name = "above-and-left"
[[output.profiles.displays]]
display = "drm-1"
position = [-1920, -1080]
scale = 1.5

[[output.profiles.displays]]
display = "drm-3"
position = [0, 0]
scale = 1.2
"#,
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
        r#"
[[output.profiles]]
name = "apart"
[[output.profiles.displays]]
display = "drm-1"
scale = 1.5

[[output.profiles.displays]]
display = "drm-3"
position = [4000, 0]
scale = 1.2
"#,
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
        r#"
[[output.profiles]]
name = "unreachable"
[[output.profiles.displays]]
display = "drm-1"

[[output.profiles.displays]]
display = "drm-3"
position = [2147483647, 0]
"#,
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
        r#"
[[output.profiles]]
name = "lid-shut"
[[output.profiles.displays]]
display = "drm-1"
enabled = false
"#,
    )
    .expect_err("a profile that enables nothing is refused");
    assert!(
        err.to_string().contains("lid-shut"),
        "the complaint should name the profile: {err}"
    );
}

#[test]
fn rejects_a_profile_that_cannot_be_applied_as_written() {
    // Each of these is a config that parses as TOML and describes no layout.
    // Grouped rather than written out one per test because the assertion is
    // the same in every case — that the config is refused at parse time, when
    // the user is still looking at it.
    for text in [
        // A profile with no displays matches only a machine with no monitors,
        // which `DrmScreen` never reports.
        r#"
[[output.profiles]]
name = "empty"
displays = []
"#,
        // Two entries for one display: which of the two places it?
        r#"
[[output.profiles]]
name = "twice"
[[output.profiles.displays]]
display = "drm-1"

[[output.profiles.displays]]
display = "drm-1"
"#,
        // Two profiles with one name: the log line that says which applied
        // would name both.
        r#"
[[output.profiles]]
name = "desk"
[[output.profiles.displays]]
display = "drm-1"


[[output.profiles]]
name = "desk"
[[output.profiles.displays]]
display = "drm-3"
"#,
        // A profile with no name, which is the name the log line has to print.
        r#"
[[output.profiles]]
name = ""
[[output.profiles.displays]]
display = "drm-1"
"#,
        // An unnamed display matches nothing, so the profile never applies.
        r#"
[[output.profiles]]
name = "anon"
[[output.profiles.displays]]
display = ""
"#,
        // A scale of zero divides the mode into a desktop of no size; a
        // negative one turns it inside out; neither is a density.
        r#"
[[output.profiles]]
name = "flat"
[[output.profiles.displays]]
display = "drm-1"
scale = 0
"#,
        r#"
[[output.profiles]]
name = "inside-out"
[[output.profiles.displays]]
display = "drm-1"
scale = -1.5
"#,
        // A transform nothing can apply.
        r#"
[[output.profiles]]
name = "sideways"
[[output.profiles.displays]]
display = "drm-1"
transform = "rotate-45"
"#,
        // A mode with no pixels on an axis, which is not something a
        // connector scans out. Checkable here, unlike whether *this* monitor
        // is at the mode: that one waits for the monitor.
        r#"
[[output.profiles]]
name = "flattened"
[[output.profiles.displays]]
display = "drm-1"
mode = [3840, 0]
"#,
        // A field nobody reads, which is a typo in one that is read.
        r#"
[[output.profiles]]
name = "typo"
[[output.profiles.displays]]
display = "drm-1"
scaale = 1.5
"#,
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
        r#"
[[output.profiles]]
name = "vanishing"
[[output.profiles.displays]]
display = "drm-1"
scale = 1e+308
"#,
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
fn a_profile_may_state_the_mode_its_positions_were_written_for() {
    // A stated mode is an assertion about the monitor rather than a request
    // to it. Nothing on this side modesets — the engine holds DRM master and
    // lights every connector at its native mode — so what a profile can do
    // with a mode is say which one its arithmetic was written against, and a
    // monitor that is at that mode is placed exactly as it is with nothing
    // stated.
    assert_eq!(
        layout(LAPTOP_AT_ITS_MODE, &[connected(LAPTOP, PANEL_MODE)]),
        layout(ONE_PANEL, &[connected(LAPTOP, PANEL_MODE)]),
        "a mode the monitor is at changes nothing about where it goes"
    );
}

#[test]
fn a_monitor_that_is_not_at_the_mode_its_profile_states_is_refused() {
    // The failure the field exists to make loud. A profile's positions are
    // sums of the modes it places, so one written for a 2880x1920 panel lays
    // the rest of the desk out around 1920 logical units that are not there
    // when the panel comes up at 1920x1080 — every display after it lands
    // somewhere nobody chose, and nothing says so. Refused rather than
    // applied at the mode that arrived, which is the silent fallback nobody
    // can see.
    let refused = Config::parse(LAPTOP_AT_ITS_MODE)
        .expect("the config should parse")
        .output
        .layout(&[connected(LAPTOP, (1920, 1080))])
        .expect_err("a monitor at another mode should be refused");
    let said = refused.to_string();
    assert!(
        said.contains("laptop-only")
            && said.contains("drm-1")
            && said.contains("2880x1920")
            && said.contains("1920x1080"),
        "the complaint should name the profile, the display, the mode it \
         states and the mode that arrived: {said}"
    );
}

#[test]
fn a_dark_monitor_is_held_to_the_mode_its_profile_states_too() {
    // Not an oversight and not a special case: a stated mode says what this
    // monitor *is*, and a monitor a profile turns off is still the monitor
    // the rest of the profile was written beside. Its own mode is also what
    // the row of connectors steps across, so a profile wrong about it is
    // wrong about where the dark ones land.
    let refused = Config::parse(
        r#"
[[output.profiles]]
name = "lid-shut"
[[output.profiles.displays]]
display = "drm-1"
enabled = false
mode = [2880, 1920]

[[output.profiles.displays]]
display = "drm-3"
scale = 1.2
"#,
    )
    .expect("the config should parse")
    .output
    .layout(&[
        connected(LAPTOP, (1920, 1080)),
        connected(CENTER, DESK_MODE),
    ])
    .expect_err("a dark monitor at another mode should be refused");
    let said = refused.to_string();
    assert!(
        said.contains("lid-shut") && said.contains("drm-1"),
        "the complaint should name the profile and the dark display: {said}"
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
const ONE_DESK: &str = r#"
[[output.profiles]]
name = "home-office-center"
[[output.profiles.displays]]
display = "drm-1"
position = [640, 1800]
scale = 1.5

[[output.profiles.displays]]
display = "drm-3"
position = [0, 0]
scale = 1.2
"#;

/// The laptop-only profile again, saying out loud which mode its scale was
/// written to divide.
const LAPTOP_AT_ITS_MODE: &str = r#"
[[output.profiles]]
name = "laptop-only"
[[output.profiles.displays]]
display = "drm-1"
mode = [2880, 1920]
scale = 1.5
"#;

/// One display, scaled and nothing else — the laptop with its lid open and
/// nothing plugged in.
const ONE_PANEL: &str = r#"
[[output.profiles]]
name = "laptop-only"
[[output.profiles.displays]]
display = "drm-1"
scale = 1.5
"#;

/// The desk with one monitor on it, and the laptop-only profile beneath it, so
/// that one config answers for both.
///
/// The panel is centered under the monitor: 1920 logical wide against 3200, so
/// (3200 - 1920) / 2 = 640 across, and 1800 down, which is the monitor's own
/// logical height.
const TWO_MONITORS: &str = r#"
[[output.profiles]]
name = "home-office-center"
[[output.profiles.displays]]
display = "drm-1"
position = [640, 1800]
scale = 1.5

[[output.profiles.displays]]
display = "drm-3"
position = [0, 0]
scale = 1.2


[[output.profiles]]
name = "laptop-only"
[[output.profiles.displays]]
display = "drm-1"
scale = 1.5
"#;

/// The full desk: three monitors on their sides and the laptop panel dark.
const HOME_OFFICE_FULL: &str = r#"
[[output.profiles]]
name = "home-office-full"
[[output.profiles.displays]]
display = "drm-1"
enabled = false

[[output.profiles.displays]]
display = "drm-2"
position = [0, 0]
scale = 1.2
transform = "rotate-270"

[[output.profiles.displays]]
display = "drm-3"
position = [1800, 0]
scale = 1.2
transform = "rotate-270"

[[output.profiles.displays]]
display = "drm-4"
position = [3600, 0]
scale = 1.2
transform = "rotate-270"
"#;

/// Two monitors written in the opposite order to the one they are placed in:
/// the entry for the monitor on the right comes first.
///
/// Which is ordinary rather than perverse -- a profile is written a monitor at
/// a time as each one's name is read off a running desktop -- and it is what
/// tells "the order they were written" apart from "the order they are placed".
const CROSSED_DESK: &str = r#"
[[output.profiles]]
name = "crossed-desk"
[[output.profiles.displays]]
display = "drm-2"
position = [1920, 0]
scale = 1.2

[[output.profiles.displays]]
display = "drm-3"
position = [0, 0]
scale = 1.5
"#;
