//! Behaviour tests for `domicile-config`, written before the implementation.
//!
//! The load-bearing requirement is hot-reload safety: a bad edit to the config
//! file on disk must NEVER take down the compositor — the last known-good
//! config stays active and the error is surfaced.

use domicile_config::{Config, ConfigError, ConfigStore, DisplayConfig, ShellRef};
use std::path::{Path, PathBuf};

// ---- parsing & defaults ---------------------------------------------------

#[test]
fn empty_config_uses_defaults() {
    let cfg = Config::parse("").expect("empty config should parse to defaults");
    assert_eq!(cfg.shell.package, ShellRef::Name("simple".into()));
    assert_eq!(cfg.compositor.nested_size, (1280, 800));
}

#[test]
fn default_keymap_is_programmers_dvorak_with_caps_swapped() {
    let keyboard = Config::parse("").unwrap().input.keyboard;
    assert_eq!(keyboard.xkb_layout, "us");
    assert_eq!(keyboard.xkb_variant, "dvp");
    assert_eq!(keyboard.xkb_options, vec!["caps:swapescape".to_string()]);
    // Empty rules/model mean "whatever libxkbcommon defaults to".
    assert_eq!(keyboard.xkb_rules, "");
    assert_eq!(keyboard.xkb_model, "");
}

#[test]
fn default_matches_parsed_empty() {
    assert_eq!(
        Config::default().shell.package,
        Config::parse("").unwrap().shell.package
    );
}

#[test]
fn parses_a_full_config() {
    let text = r##"
        [shell]
        package = "./apps/shell"

        [shell.settings]
        accent = "#ff0088"
        show_clock = true

        [compositor]
        nested_size = [1920, 1080]
    "##;
    let cfg = Config::parse(text).expect("valid config should parse");
    assert_eq!(
        cfg.shell.package,
        ShellRef::Path(PathBuf::from("./apps/shell"))
    );
    assert_eq!(cfg.compositor.nested_size, (1920, 1080));
    // Shell settings are opaque and passed through to the chrome package.
    assert_eq!(
        cfg.shell.settings.get("accent").and_then(|v| v.as_str()),
        Some("#ff0088")
    );
    assert_eq!(
        cfg.shell
            .settings
            .get("show_clock")
            .and_then(|v| v.as_bool()),
        Some(true)
    );
}

// ---- keyboard / keymap ------------------------------------------------------

#[test]
fn parses_keyboard_settings() {
    let text = r##"
        [input.keyboard]
        xkb_rules = "evdev"
        xkb_model = "pc105"
        xkb_layout = "us,de"
        xkb_variant = "dvp,"
        xkb_options = ["caps:swapescape", "grp:alt_shift_toggle"]
    "##;
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
    let keyboard =
        Config::parse("[input.keyboard]\nxkb_options = [\"caps:swapescape\", \"compose:ralt\"]\n")
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
    let keyboard = Config::parse("[input.keyboard]\nxkb_options = []\n")
        .unwrap()
        .input
        .keyboard;
    assert_eq!(keyboard.xkb_options_string(), "");
}

#[test]
fn rejects_empty_keyboard_layout() {
    let err = Config::parse("[input.keyboard]\nxkb_layout = \"\"\n").unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_blank_keyboard_option() {
    // A stray comma in a hand-edited list would otherwise reach xkb as junk.
    let err =
        Config::parse("[input.keyboard]\nxkb_options = [\"caps:swapescape\", \"\"]\n").unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_invalid_syntax() {
    let err = Config::parse("this is = = not toml").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

#[test]
fn rejects_unknown_top_level_shell_key() {
    // Typos in known sections should surface, not be silently ignored.
    let err = Config::parse("[shell]\npackag = \"simple\"\n").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

#[test]
fn rejects_zero_nested_size() {
    let err = Config::parse("[compositor]\nnested_size = [0, 600]\n").unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

// ---- chrome-package reference resolution -----------------------------------

#[test]
fn shellref_parses_bare_name() {
    assert_eq!(
        "simple".parse::<ShellRef>().unwrap(),
        ShellRef::Name("simple".into())
    );
}

#[test]
fn shellref_parses_paths() {
    for s in ["./x", "../x", "/opt/x", "a/b"] {
        let parsed = s.parse::<ShellRef>().unwrap();
        assert!(
            matches!(parsed, ShellRef::Path(_)),
            "{s} should parse as a Path, got {parsed:?}"
        );
    }
}

#[test]
fn shellref_rejects_empty() {
    assert!("".parse::<ShellRef>().is_err());
    assert!("   ".parse::<ShellRef>().is_err());
}

#[test]
fn shellref_resolves_name_under_shells_dir() {
    let name = ShellRef::Name("simple".into());
    assert_eq!(
        name.resolve(Path::new("/etc/domicile/shells")),
        PathBuf::from("/etc/domicile/shells/simple")
    );
}

#[test]
fn shellref_resolves_absolute_path_unchanged() {
    let p = ShellRef::Path(PathBuf::from("/opt/mychrome"));
    assert_eq!(
        p.resolve(Path::new("/etc/domicile/shells")),
        PathBuf::from("/opt/mychrome")
    );
}

// ---- hot-reload semantics (the important part) ----------------------------

#[test]
fn store_reload_valid_swaps_current_and_clears_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str("[compositor]\nnested_size = [800, 600]\n")
        .unwrap();
    assert_eq!(store.current().compositor.nested_size, (800, 600));
    assert!(store.last_error().is_none());
}

#[test]
fn store_reload_invalid_keeps_last_good_and_records_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str("[compositor]\nnested_size = [800, 600]\n")
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
        .reload_from_str("[compositor]\nnested_size = [640, 480]\n")
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
    let path = dir.path().join("domicile.toml");
    std::fs::write(&path, "[compositor]\nnested_size = [1024, 768]\n").unwrap();

    let cfg = Config::load(&path).unwrap();
    assert_eq!(cfg.compositor.nested_size, (1024, 768));
}

#[test]
fn missing_file_is_an_io_error() {
    let err = Config::load("/no/such/domicile.toml").unwrap_err();
    assert!(matches!(err, ConfigError::Io { .. }), "got {err:?}");
}

#[test]
fn store_reload_from_path_keeps_last_good_on_bad_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.toml");
    std::fs::write(&path, "[compositor]\nnested_size = [1024, 768]\n").unwrap();

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
    assert_eq!(Config::parse("").unwrap().output.max_scale, 2);
}

#[test]
fn max_scale_one_turns_hidpi_off() {
    // The escape hatch: every pixel costs the readback, the socket and the IPC
    // hop squared, so a user who would rather have the latency than the
    // sharpness needs a way to say so without a rebuild.
    assert_eq!(
        Config::parse("[output]\nmax_scale = 1\n")
            .unwrap()
            .output
            .max_scale,
        1
    );
}

#[test]
fn max_scale_must_leave_a_usable_scale() {
    let err = Config::parse("[output]\nmax_scale = 0\n").unwrap_err();
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
    assert_eq!(Config::parse("").unwrap().output.displays, vec![]);
}

#[test]
fn parses_a_side_by_side_desktop() {
    let text = r##"
        [[output.displays]]
        name = "left"
        position = [0, 0]
        size = [1920, 1080]

        [[output.displays]]
        name = "right"
        position = [1920, 0]
        size = [2560, 1440]
        scale = 2
    "##;
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
    let displays = Config::parse("[[output.displays]]\nname = \"only\"\nsize = [800, 600]\n")
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
        "[[output.displays]]\nname = \"hdmi\"\nsize = [800, 600]\n\
         [[output.displays]]\nname = \"hdmi\"\nposition = [800, 0]\nsize = [800, 600]\n",
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
    let err =
        Config::parse("[[output.displays]]\nname = \"left \"\nsize = [800, 600]\n").unwrap_err();
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
        "[[output.displays]]\nname = \"real\"\nsize = [800, 600]\n\
         [[output.displays]]\nname = \"\"\nposition = [800, 0]\nsize = [800, 600]\n",
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
            "[[output.displays]]\nname = \"dead\"\nsize = {size}\n"
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
    let err = Config::parse("[[output.displays]]\nname = \"tiny\"\nsize = [800, 600]\nscale = 0\n")
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
            "[[output.displays]]\nname = \"far\"\nposition = {position}\nsize = [1920, 1080]\n"
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
        "[[output.displays]]\nname = \"left\"\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"right\"\nposition = [1900, 0]\nsize = [1920, 1080]\n",
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
        "[[output.displays]]\nname = \"left\"\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"right\"\nposition = [1920, 0]\nsize = [1920, 1080]\n",
    )
    .expect("side-by-side displays should parse");
    Config::parse(
        "[[output.displays]]\nname = \"top\"\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"bottom\"\nposition = [0, 1080]\nsize = [1920, 1080]\n",
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
        "[[output.displays]]\nname = \"here\"\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"far\"\nposition = [2147479647, 2000]\nsize = [4000, 8000]\n",
    )
    .expect("a desktop exactly as wide as a position can describe should parse");
    // One pixel past it, which is what pins the display's *length* as part of
    // the reach. The near display sits at -1 so that the far one's own corner
    // still fits — otherwise the per-display check rejects this first and the
    // layout check is never asked. Without the length, the far position alone
    // is under the limit and this desktop is accepted.
    let err = Config::parse(
        "[[output.displays]]\nname = \"here\"\nposition = [-1, 0]\nsize = [10, 10]\n\
         [[output.displays]]\nname = \"far\"\nposition = [2147479647, 2000]\nsize = [4000, 8000]\n",
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("from here to far"),
        "the layout check should be the one that answers, not the per-display one: {err}"
    );
    Config::parse(
        "[[output.displays]]\nname = \"here\"\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"below\"\nposition = [3000, 2147482567]\nsize = [1920, 1080]\n",
    )
    .expect("a desktop exactly as tall as a position can describe should parse");
}

#[test]
fn the_desktop_must_fit_the_coordinate_space_on_both_axes() {
    // Stacked rather than side by side. The horizontal case cannot tell
    // whether the vertical one reads the right fields — or is checked at all.
    let err = Config::parse(
        "[[output.displays]]\nname = \"north\"\nposition = [0, -2000000000]\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"south\"\nposition = [0, 2000000000]\nsize = [1920, 1080]\n",
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
        "[[output.displays]]\nname = \"huge\"\nposition = [2000000000, 0]\nsize = [1000000000, 1080]\n",
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
        "[[output.displays]]\nname = \"west\"\nposition = [-2000000000, 0]\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"far\"\nposition = [2147483000, 0]\nsize = [1920, 1080]\n",
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
        "[[output.displays]]\nname = \"west\"\nposition = [-2000000000, 0]\nsize = [1920, 1080]\n\
         [[output.displays]]\nname = \"east\"\nposition = [2000000000, 0]\nsize = [1920, 1080]\n",
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
        "[[output.displays]]\nname = \"dense\"\nsize = [1920, 1080]\nscale = 2000000\n",
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
    Config::parse("[[output.displays]]\nname = \"exact\"\nsize = [2147483647, 1080]\n")
        .expect("a mode exactly as wide as a coordinate should parse");
    Config::parse("[[output.displays]]\nname = \"over\"\nsize = [2147483648, 1080]\n")
        .expect_err("one pixel more than a coordinate should not");

    // Each axis on its own, and each with the *other* axis comfortably inside
    // the bound: a case that trips both halves at once cannot tell whether
    // either is checked.
    let err =
        Config::parse("[[output.displays]]\nname = \"wide\"\nsize = [2147483647, 1]\nscale = 2\n")
            .unwrap_err();
    assert!(
        format!("{err}").contains("wide"),
        "the width half is checked with a height that fits: {err}"
    );
    let err =
        Config::parse("[[output.displays]]\nname = \"tall\"\nsize = [1, 2147483647]\nscale = 2\n")
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
        "[[output.displays]]\nname = \"huge\"\nsize = [4294967295, 4294967295]\nscale = 4294967295\n",
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
        "[compositor]\nnested_size = [2000000000, 800]\n\n[output]\nmax_scale = 10\n",
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
    Config::parse("[compositor]\nnested_size = [2000000000, 800]\n\n[output]\nmax_scale = 1\n")
        .expect("a large desktop at scale 1 is representable");
    Config::parse("[output]\nmax_scale = 10\n").expect("a high cap on a small desktop is fine");

    // The boundary, exactly, and one past it.
    Config::parse("[compositor]\nnested_size = [2147483647, 1]\n\n[output]\nmax_scale = 1\n")
        .expect("a mode exactly as wide as a coordinate should parse");
    Config::parse("[compositor]\nnested_size = [2147483648, 1]\n\n[output]\nmax_scale = 1\n")
        .expect_err("one pixel more than a coordinate should not");

    // Each axis with the other comfortably inside the bound, so neither case
    // can pass on the strength of the half it is not about.
    let err =
        Config::parse("[compositor]\nnested_size = [2147483647, 1]\n\n[output]\nmax_scale = 2\n")
            .unwrap_err();
    assert!(
        format!("{err}").contains("nested_size"),
        "the width half is checked with a height that fits: {err}"
    );
    let err =
        Config::parse("[compositor]\nnested_size = [1, 2147483647]\n\n[output]\nmax_scale = 2\n")
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
        "[compositor]\nnested_size = [2000000000, 800]\n\n[output]\nmax_scale = 10\n\
         [[output.displays]]\nname = \"only\"\nsize = [1920, 1080]\n",
    )
    .expect_err("an unrepresentable nested mode is rejected whatever else is configured");

    // The largest inputs the types allow, which an `i64` product wrapped or
    // panicked on. A panic here would also break `ConfigStore`'s guarantee
    // that a bad config can never take the compositor down.
    let err = Config::parse(
        "[compositor]\nnested_size = [4294967295, 4294967295]\n\n[output]\nmax_scale = 4294967295\n",
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "the biggest nested mode the types allow is rejected, not a panic or a wrap: {err:?}"
    );
}
