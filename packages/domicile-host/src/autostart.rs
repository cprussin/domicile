//! Autostart entries for the Background portal's `EnableAutostart`.
//!
//! An application that asks to start with the session gets
//! `$XDG_CONFIG_HOME/autostart/<app_id>.desktop`, which the session starts at
//! login. See `docs/PORTALS.md`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Write or remove `app_id`'s autostart entry under `config_home`. Returns
/// whether it now starts with the session.
///
/// `dbus_activatable` is the portal's flag `1`: the session starts it by
/// D-Bus activation instead of running `commandline`.
pub fn set(
    config_home: &Path,
    app_id: &str,
    enable: bool,
    commandline: &[String],
    dbus_activatable: bool,
) -> io::Result<bool> {
    let path = entry_path(config_home, app_id)?;
    if enable {
        fs::create_dir_all(path.parent().expect("the entry is in a directory"))?;
        fs::write(&path, entry(app_id, commandline, dbus_activatable))?;
        Ok(true)
    } else {
        match fs::remove_file(&path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(false),
        }
    }
}

/// Where `app_id`'s entry goes. Refuses an id that is not a plain file name,
/// so an application cannot write outside the autostart directory.
fn entry_path(config_home: &Path, app_id: &str) -> io::Result<PathBuf> {
    let plain = !app_id.is_empty()
        && !app_id.starts_with('.')
        && app_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if plain {
        Ok(config_home
            .join("autostart")
            .join(format!("{app_id}.desktop")))
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{app_id:?} is not an application id"),
        ))
    }
}

/// The entry's text.
fn entry(app_id: &str, commandline: &[String], dbus_activatable: bool) -> String {
    let exec = commandline
        .iter()
        .map(|argument| escaped(&quoted(argument)))
        .collect::<Vec<_>>()
        .join(" ");
    let activation = if dbus_activatable {
        "DBusActivatable=true\n"
    } else {
        ""
    };
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={app_id}\n\
         Exec={exec}\n\
         X-XDP-Autostart={app_id}\n\
         {activation}"
    )
}

/// One `Exec` argument, quoted when it holds a reserved character, with `%`
/// doubled so it is no field code.
fn quoted(argument: &str) -> String {
    const RESERVED: &str = " \t\n\"'\\><~|&;$*?#()`";
    let argument = argument.replace('%', "%%");
    if argument.chars().any(|c| RESERVED.contains(c)) {
        let inner: String = argument
            .chars()
            .flat_map(|c| match c {
                '"' | '`' | '$' | '\\' => vec!['\\', c],
                _ => vec![c],
            })
            .collect();
        format!("\"{inner}\"")
    } else {
        argument
    }
}

/// A string value with the key file's escapes.
fn escaped(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
        .replace('\r', "\\r")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(config_home: &Path, app_id: &str) -> String {
        fs::read_to_string(config_home.join(format!("autostart/{app_id}.desktop")))
            .expect("the entry is there")
    }

    #[test]
    fn an_application_that_asks_starts_with_the_session() {
        let config = tempfile::tempdir().expect("a directory");

        let enabled = set(
            config.path(),
            "org.example.Chat",
            true,
            &["chat".into(), "--hidden".into()],
            false,
        )
        .expect("it is written");

        assert!(enabled);
        assert_eq!(
            read(config.path(), "org.example.Chat"),
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=org.example.Chat\n\
             Exec=chat --hidden\n\
             X-XDP-Autostart=org.example.Chat\n"
        );
    }

    #[test]
    fn arguments_are_quoted_as_the_desktop_entry_spec_says() {
        let config = tempfile::tempdir().expect("a directory");

        set(
            config.path(),
            "org.example.Chat",
            true,
            &[
                "/opt/My Chat/chat".into(),
                "--greeting=\"hi\" $USER".into(),
                "100%".into(),
                "a\\b".into(),
            ],
            true,
        )
        .expect("it is written");

        let entry = read(config.path(), "org.example.Chat");
        assert!(
            entry.contains(
                "Exec=\"/opt/My Chat/chat\" \"--greeting=\\\\\"hi\\\\\" \\\\$USER\" 100%% \"a\\\\\\\\b\"\n"
            ),
            "{entry}"
        );
        assert!(entry.ends_with("DBusActivatable=true\n"), "{entry}");
    }

    #[test]
    fn disabling_removes_the_entry() {
        let config = tempfile::tempdir().expect("a directory");
        set(
            config.path(),
            "org.example.Chat",
            true,
            &["chat".into()],
            false,
        )
        .expect("it is written");

        let enabled =
            set(config.path(), "org.example.Chat", false, &[], false).expect("it is removed");

        assert!(!enabled);
        assert!(!config
            .path()
            .join("autostart/org.example.Chat.desktop")
            .exists());
        assert!(
            !set(config.path(), "org.example.Chat", false, &[], false).expect("nothing to remove"),
            "disabling twice is no error"
        );
    }

    #[test]
    fn an_app_id_that_is_not_a_file_name_is_refused() {
        let config = tempfile::tempdir().expect("a directory");

        for app_id in ["", "../evil", "a/b", ".hidden"] {
            assert_eq!(
                set(config.path(), app_id, true, &["evil".into()], false)
                    .expect_err("refused")
                    .kind(),
                io::ErrorKind::InvalidInput,
                "{app_id:?}"
            );
        }
    }
}
