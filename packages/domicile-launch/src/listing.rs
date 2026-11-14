//! How `domicile list-*` prints what the desktop said, for a person. `--json`
//! prints the desktop's answer instead, for scripts.

use std::path::Path;

use domicile_protocol::{DesktopStatus, ListedDisplay, ListedWindow};
use serde::Serialize;

/// Each display as a block: its names, mode, layout and color.
pub fn displays_table(displays: &[ListedDisplay]) -> String {
    displays
        .iter()
        .map(|listed| {
            let display = &listed.display;
            let refresh = match display.refresh_mhz {
                0 => String::new(),
                mhz => format!(" @ {}.{:03} Hz", mhz / 1000, mhz % 1000),
            };
            format!(
                "{} ({})\n  names     {}\n  mode      {}x{}{refresh}\n  \
                 layout    {}x{} at {},{}, scale {}, {}\n  \
                 color     HDR {}, adaptive sync {}\n",
                display.name,
                if listed.lit { "lit" } else { "off" },
                listed.names.join(", "),
                display.mode[0],
                display.mode[1],
                display.size[0],
                display.size[1],
                display.position[0],
                display.position[1],
                display.scale,
                wire_word(display.transform),
                wire_word(display.hdr),
                wire_word(display.adaptive_sync),
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Every window as one row of an aligned table.
pub fn windows_table(windows: &[ListedWindow]) -> String {
    let header = ["ID", "KIND", "APP", "PID", "SIZE", "TITLE"].map(str::to_string);
    let rows: Vec<[String; 6]> = std::iter::once(header)
        .chain(windows.iter().map(|window| {
            let title = match window.title.as_str() {
                "" => "-",
                title => title,
            };
            let state = match (window.focused, window.urgent) {
                (true, _) => " (focused)",
                (false, true) => " (urgent)",
                (false, false) => "",
            };
            [
                window.id.clone(),
                wire_word(window.kind),
                window.app.clone().unwrap_or_else(|| "-".to_string()),
                window
                    .pid
                    .map_or_else(|| "-".to_string(), |pid| pid.to_string()),
                window.size.map_or_else(
                    || "-".to_string(),
                    |[width, height]| format!("{}x{}", width.round(), height.round()),
                ),
                format!("{title}{state}"),
            ]
        }))
        .collect();
    let widths: Vec<usize> = (0..5)
        .map(|column| {
            rows.iter()
                .map(|row| row[column].chars().count())
                .max()
                .expect("the header is a row")
        })
        .collect();
    rows.iter()
        .map(|row| {
            let padded: String = widths
                .iter()
                .zip(row)
                .map(|(width, cell)| format!("{cell:<width$}  "))
                .collect();
            format!("{padded}{}\n", row[5])
        })
        .collect()
}

/// How the desktop is, one line per question, with `-` for none.
pub fn status_table(shell: &Path, status: &DesktopStatus) -> String {
    let or_none = |said: String| match said.as_str() {
        "" => "-".to_string(),
        _ => said,
    };
    let lines = [
        ("shell", shell.display().to_string()),
        ("theme", wire_word(status.theme)),
        ("keymap", or_none(status.keymap.clone().unwrap_or_default())),
        (
            "locked",
            if status.locked { "yes" } else { "no" }.to_string(),
        ),
        (
            "screens",
            if status.screens_off { "off" } else { "lit" }.to_string(),
        ),
        ("held awake", or_none(status.held_awake_by.join(", "))),
        (
            "capturing",
            or_none(
                status
                    .capturing
                    .iter()
                    .map(|capturing| {
                        let kind = serde_json::to_value(&capturing.kind)
                            .expect("a capture always serializes");
                        format!(
                            "{} ({})",
                            capturing.app_id,
                            kind["kind"].as_str().expect("a capture's kind is a word")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
        ),
    ];
    lines
        .iter()
        .map(|(question, answer)| format!("{question:<10}  {answer}\n"))
        .collect()
}

/// How the wire spells `value`, such as `rotate-90` or `native`.
fn wire_word(value: impl Serialize) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(word)) => word,
        other => panic!("a listed enum is a word on the wire, not {other:?}"),
    }
}
