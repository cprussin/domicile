//! Applications named and drawn by their desktop entries, for a notification
//! the portal sends under an application's id.

use std::fs;
use std::path::PathBuf;

use crate::mime_apps::{entry_files, keys, unescaped};

/// An application as a notification names and draws it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct App {
    pub name: String,
    /// An icon's name or a path, as `Notify`'s `app_icon` takes it.
    pub icon: String,
}

/// `app_id` named and drawn by its desktop entry under `application_dirs`.
///
/// The entry is the one whose desktop file id is `app_id`, else the first
/// whose id, `StartupWMClass` or `Name` is `app_id` or its last reverse-DNS
/// part, ignoring case: a portal can name an application by an id its entry
/// does not use, as `com.chromium.Chromium` for `chromium-browser.desktop`.
/// With none, the last part is the name, capitalized, `-` and `_` as spaces.
pub fn app(app_id: &str, application_dirs: &[PathBuf]) -> App {
    let entries = entries(application_dirs);
    let last = app_id.rsplit_once('.').map_or(app_id, |(_, last)| last);
    let wanted = [app_id.to_lowercase(), last.to_lowercase()];
    let matches = |entry: &&Entry| {
        [
            Some(&entry.id),
            entry.window_class.as_ref(),
            Some(&entry.name),
        ]
        .into_iter()
        .flatten()
        .any(|name| wanted.contains(&name.to_lowercase()))
    };
    entries
        .iter()
        .find(|entry| entry.id == app_id)
        .or_else(|| entries.iter().find(matches))
        .map_or_else(
            || App {
                name: readable(last),
                icon: app_id.to_string(),
            },
            |entry| App {
                name: entry.name.clone(),
                icon: entry.icon.clone().unwrap_or_else(|| app_id.to_string()),
            },
        )
}

/// A desktop entry's keys that name and draw its application.
struct Entry {
    /// Its desktop file id without `.desktop`.
    id: String,
    name: String,
    window_class: Option<String>,
    icon: Option<String>,
}

/// Every application under `dirs` that has a `Name`, sorted by id. An id in an
/// earlier directory hides the same id in later ones.
fn entries(dirs: &[PathBuf]) -> Vec<Entry> {
    let mut found: Vec<(String, PathBuf)> = Vec::new();
    for (id, path) in dirs.iter().flat_map(|dir| entry_files(dir, dir)) {
        if !found.iter().any(|(seen, _)| *seen == id) {
            found.push((id, path));
        }
    }
    found.sort();
    found
        .into_iter()
        .filter_map(|(id, path)| {
            // The spec says to ignore unreadable files.
            let text = fs::read_to_string(path).ok()?;
            let keys = keys(&text);
            let usable =
                keys.get("Type") == Some(&"Application") && keys.get("Hidden") != Some(&"true");
            let name = keys.get("Name").filter(|_| usable)?;
            Some(Entry {
                id: id.strip_suffix(".desktop").unwrap_or(&id).to_string(),
                name: unescaped(name),
                window_class: keys.get("StartupWMClass").map(|class| class.to_string()),
                icon: keys.get("Icon").map(|icon| icon.to_string()),
            })
        })
        .collect()
}

/// `part` capitalized, with `-` and `_` as spaces.
fn readable(part: &str) -> String {
    let words = part.replace(['-', '_'], " ");
    let mut chars = words.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// An `applications/` directory holding `entries`, as file names and text.
    fn applications(entries: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a directory to write in");
        for (name, text) in entries {
            fs::write(dir.path().join(name), text).unwrap();
        }
        dir
    }

    fn entry(name: &str, extra: &str) -> String {
        format!("[Desktop Entry]\nType=Application\nName={name}\nExec=app\n{extra}")
    }

    fn named(app_id: &str, dir: &tempfile::TempDir) -> App {
        app(app_id, &[dir.path().to_path_buf()])
    }

    #[test]
    fn an_id_is_named_and_drawn_by_its_entry() {
        let dir = applications(&[(
            "org.gnome.Evince.desktop",
            &entry("Document\\sViewer", "Icon=evince\n"),
        )]);

        assert_eq!(
            named("org.gnome.Evince", &dir),
            App {
                name: "Document Viewer".into(),
                icon: "evince".into(),
            }
        );
    }

    #[test]
    fn an_id_finds_an_entry_named_differently() {
        let dir = applications(&[
            (
                "chromium-browser.desktop",
                &entry("Chromium", "Icon=chromium\n"),
            ),
            (
                "editor.desktop",
                &entry("Editor", "StartupWMClass=org.example.TextEditor\n"),
            ),
        ]);

        assert_eq!(named("com.chromium.Chromium", &dir).name, "Chromium");
        assert_eq!(named("com.chromium.Chromium", &dir).icon, "chromium");
        assert_eq!(named("org.example.TextEditor", &dir).name, "Editor");
    }

    #[test]
    fn an_id_with_no_entry_is_made_readable() {
        let dir = applications(&[]);

        assert_eq!(
            named("org.example.my-app", &dir),
            App {
                name: "My app".into(),
                icon: "org.example.my-app".into(),
            }
        );
    }
}
