//! An application's name and icon from its desktop entry, for portal dialogs
//! to name who asks and what they may share.
//!
//! See `docs/PORTALS.md`.

use std::fs;
use std::path::PathBuf;

use crate::tray::TrayIcons;

/// What a desktop entry says of its application.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Described {
    pub name: Option<String>,
    /// As a `data:` URL.
    pub icon: Option<String>,
}

/// Desktop entries under the XDG data directories.
pub struct DesktopEntries {
    data_dirs: Vec<PathBuf>,
    icons: TrayIcons,
}

impl DesktopEntries {
    /// Look under `data_dirs`, highest priority first.
    pub fn new(data_dirs: Vec<PathBuf>) -> Self {
        DesktopEntries {
            icons: TrayIcons::new(data_dirs.clone()),
            data_dirs,
        }
    }

    /// The entry for `app_id`, a desktop file id without `.desktop`. The
    /// first directory that has one wins, as for launching.
    pub fn describe(&mut self, app_id: &str) -> Described {
        let Some(entry) = self.data_dirs.iter().find_map(|dir| {
            fs::read_to_string(dir.join("applications").join(format!("{app_id}.desktop"))).ok()
        }) else {
            return Described::default();
        };
        let name = key(&entry, "Name");
        let icon = key(&entry, "Icon").and_then(|icon| self.icons.icon(&icon, ""));
        Described { name, icon }
    }
}

/// The unlocalized `key` of the `[Desktop Entry]` group.
fn key(entry: &str, key: &str) -> Option<String> {
    entry
        .lines()
        .skip_while(|line| line.trim() != "[Desktop Entry]")
        .skip(1)
        .take_while(|line| !line.starts_with('['))
        .find_map(|line| {
            let (name, value) = line.split_once('=')?;
            (name.trim() == key).then(|| value.trim().to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    #[test]
    fn an_entry_gives_its_name_and_its_icon() {
        let data = tempfile::tempdir().expect("a directory");
        let applications = data.path().join("applications");
        let icons = data.path().join("icons/hicolor/48x48/apps");
        fs::create_dir_all(&applications).expect("made");
        fs::create_dir_all(&icons).expect("made");
        fs::write(
            applications.join("org.gnome.TextEditor.desktop"),
            "[Desktop Entry]\nName[de]=Texteditor\nName=Text Editor\nIcon=org.gnome.TextEditor\n\n[Desktop Action new]\nName=New Window\n",
        )
        .expect("written");
        fs::write(icons.join("org.gnome.TextEditor.png"), PNG).expect("written");

        let described =
            DesktopEntries::new(vec![data.path().to_path_buf()]).describe("org.gnome.TextEditor");

        assert_eq!(described.name.as_deref(), Some("Text Editor"));
        assert!(
            described
                .icon
                .is_some_and(|icon| icon.starts_with("data:image/png;base64,")),
            "the icon is read"
        );
    }

    #[test]
    fn an_app_without_an_entry_is_not_described() {
        let data = tempfile::tempdir().expect("a directory");

        assert_eq!(
            DesktopEntries::new(vec![data.path().to_path_buf()]).describe("unknown"),
            Described::default()
        );
    }
}
