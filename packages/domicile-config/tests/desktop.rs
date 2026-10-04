//! Tests for the desktop built from a configured display layout.
//!
//! The config may place a display anywhere, but the nested window, the chrome
//! page and `getBoundingClientRect` all assume the desktop starts at zero.

use domicile_config::{Config, Desktop};

/// The desktop a config describes, or a panic naming the config that had none.
fn desktop(text: &str) -> Desktop {
    Config::parse(text)
        .expect("the config should parse")
        .output
        .desktop()
        .expect("the config should describe a desktop")
}

#[test]
fn no_displays_configured_is_no_desktop() {
    // No desktop means "follow Domicile's own window". An empty desktop would
    // give that case a size of zero.
    assert!(
        Config::parse("{}").unwrap().output.desktop().is_none(),
        "an unconfigured desktop is absent rather than empty"
    );
}

#[test]
fn a_desktop_is_as_big_as_the_displays_it_holds() {
    let desktop = desktop(
        r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [2560, 1440] }
    ]
  }
}
"#,
    );
    assert_eq!(desktop.size(), (4480, 1440));
}

#[test]
fn a_gap_between_displays_is_part_of_the_desktop() {
    // The page spans gaps, so the bounding box includes them.
    let desktop = desktop(
        r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [3000, 0], "size": [1920, 1080] }
    ]
  }
}
"#,
    );
    assert_eq!(desktop.size(), (4920, 1080));
}

#[test]
fn the_desktop_starts_at_the_origin_however_the_config_placed_it() {
    // The nested window's transform is a pure scale and the chrome layer sits
    // at the origin, so both need a desktop that starts at zero. Negative
    // positions are valid config.
    let desktop = desktop(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "left",
        "position": [-1920, -100],
        "size": [1920, 1080]
      },
      { "name": "right", "position": [0, 0], "size": [2560, 1440] }
    ]
  }
}
"#,
    );
    let placed: Vec<_> = desktop
        .displays()
        .map(|display| (display.name.as_str(), display.position))
        .collect();
    assert_eq!(placed, vec![("left", (0, 0)), ("right", (1920, 100))]);
    assert_eq!(desktop.size(), (4480, 1540));
}

#[test]
fn normalizing_moves_the_desktop_without_reshaping_it() {
    // The same layout written about a different origin is the same desktop.
    let here = desktop(
        r#"
{
  "output": {
    "displays": [
      { "name": "a", "size": [800, 600] },
      { "name": "b", "position": [800, 0], "size": [800, 600] }
    ]
  }
}
"#,
    );
    let there = desktop(
        r#"
{
  "output": {
    "displays": [
      { "name": "a", "position": [5000, -7000], "size": [800, 600] },
      { "name": "b", "position": [5800, -7000], "size": [800, 600] }
    ]
  }
}
"#,
    );
    assert_eq!(
        here.displays().collect::<Vec<_>>(),
        there.displays().collect::<Vec<_>>()
    );
    assert_eq!(here.size(), there.size());
}

#[test]
fn displays_keep_the_order_the_config_wrote_them_in() {
    // The chrome receives displays in this order, so a shell that renders
    // them by index gets the order the user wrote.
    let desktop = desktop(
        r#"
{
  "output": {
    "displays": [
      { "name": "c", "position": [4000, 0], "size": [800, 600] },
      { "name": "a", "size": [800, 600] },
      { "name": "b", "position": [2000, 0], "size": [800, 600] }
    ]
  }
}
"#,
    );
    let names: Vec<_> = desktop.displays().map(|d| d.name.as_str()).collect();
    assert_eq!(names, vec!["c", "a", "b"]);
}

#[test]
fn a_display_carries_what_its_clients_and_its_screen_need() {
    // The other tests use the default scale, so they would pass with a
    // hardcoded one.
    let desktop = desktop(
        r#"
{
  "output": {
    "displays": [{ "name": "retina", "size": [2560, 1440], "scale": 2 }]
  }
}
"#,
    );
    let display = desktop.displays().next().expect("the one display");
    assert_eq!(display.name, "retina");
    assert_eq!(display.scale, 2);
    assert_eq!(display.size, (2560, 1440));
}

#[test]
fn an_unvalidated_layout_says_so_rather_than_wrapping() {
    // `OutputConfig` derives `Deserialize` and has public fields, so
    // `desktop()` can run on a layout `Config::parse` never validated. In
    // release, a wrapped subtraction would give silently wrong geometry.
    let unvalidated: Config = serde_json::from_str(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "west",
        "position": [-2000000000, 0],
        "size": [1920, 1080]
      },
      {
        "name": "east",
        "position": [2000000000, 0],
        "size": [1920, 1080]
      }
    ]
  }
}
"#,
    )
    .expect("the shape is valid; only the layout is impossible");
    let panicked = std::panic::catch_unwind(|| unvalidated.output.desktop())
        .expect_err("an unvalidated layout must not build a desktop");
    // Check the message: tests run with `overflow-checks`, so a plain
    // overflow would also panic.
    assert_eq!(
        panicked.downcast_ref::<String>().map(String::as_str),
        Some("the layout's extent is validated before a desktop is built"),
        "the panic should name the invariant rather than be an incidental overflow"
    );
}

#[test]
fn an_unvalidated_display_says_so_rather_than_wrapping() {
    // `reach` adds a display's size to its position. It relies on
    // `DisplayConfig::validate` bounding that size.
    let unvalidated: Config = serde_json::from_str(
        r#"
{
  "output": {
    "displays": [
      { "name": "origin", "size": [10, 10] },
      {
        "name": "wide",
        "position": [2000000000, 0],
        "size": [3000000000, 10]
      }
    ]
  }
}
"#,
    )
    .expect("the shape is valid; only the display is impossible");
    let panicked = std::panic::catch_unwind(|| unvalidated.output.desktop())
        .expect_err("an unvalidated display must not build a desktop");
    assert_eq!(
        panicked.downcast_ref::<String>().map(String::as_str),
        Some("a display's own size is validated before a desktop is built"),
        "the panic should name the invariant rather than be an incidental overflow"
    );
}
