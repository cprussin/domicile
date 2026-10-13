//! The desktop entry `domicile install-app` writes: one that runs
//! `domicile open-app` on the app's start URL.

use std::path::Path;

/// The desktop entry for an app called `name` that starts at `start_url`.
///
/// `icon` is an absolute path. Values are escaped per the Desktop Entry
/// Specification, so a site's name or address cannot add a line or a field
/// code.
pub fn desktop_entry(name: &str, start_url: &str, icon: Option<&Path>) -> String {
    let icon = icon
        .map(|icon| format!("Icon={}\n", escaped(&icon.to_string_lossy())))
        .unwrap_or_default();
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={}\n\
         {icon}\
         Exec=domicile open-app {}\n",
        escaped(name),
        escaped(&quoted(start_url)).replace('%', "%%"),
    )
}

/// The file name, without `.desktop`, for an app that starts at `start_url`:
/// its host and path, so installing the same app again replaces its entry.
pub fn file_stem(start_url: &str) -> String {
    let address = start_url
        .split_once("://")
        .map_or(start_url, |(_, rest)| rest);
    let address = address.split(['?', '#']).next().unwrap_or_default();
    let words: Vec<String> = address
        .to_ascii_lowercase()
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '.'))
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect();
    format!("domicile-app-{}", words.join("-"))
}

/// `argument` as one quoted `Exec` argument.
fn quoted(argument: &str) -> String {
    let inner: String = argument
        .chars()
        .map(|c| match c {
            '"' | '`' | '$' | '\\' => format!("\\{c}"),
            _ => c.to_string(),
        })
        .collect();
    format!("\"{inner}\"")
}

/// `value` with the escapes every string value takes.
fn escaped(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\\' => "\\\\".to_string(),
            '\n' => "\\n".to_string(),
            '\t' => "\\t".to_string(),
            '\r' => "\\r".to_string(),
            _ => c.to_string(),
        })
        .collect()
}
