//! Which application opens a type: `mimeapps.list` and `MimeType`.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use domicile_host::mime_apps::{default_handler, lists};

/// A directory holding `files`, as relative paths and text.
fn written(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a directory to write in");
    for (path, text) in files {
        let at = dir.path().join(path);
        fs::create_dir_all(at.parent().expect("a parent")).unwrap();
        fs::write(at, text).unwrap();
    }
    dir
}

fn handler(exec: &str, mime: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=Mail\nExec={exec}\nMimeType=text/plain;{mime};\n"
    )
}

fn list(group: &str, ids: &str) -> String {
    format!("[{group}]\nx-scheme-handler/mailto={ids}\n")
}

/// The default `mailto` handler's command for `a@example.com`, from `lists`
/// under `config` and the entries under `applications`.
fn opened(config: &Path, lists: &[&str], applications: &Path) -> Option<Vec<String>> {
    let lists: Vec<PathBuf> = lists.iter().map(|name| config.join(name)).collect();
    default_handler(
        "x-scheme-handler/mailto",
        &lists,
        &[applications.to_path_buf()],
    )
    .map(|handler| {
        handler
            .command("mailto:a@example.com")
            .expect("a readable command")
    })
}

mod choosing {
    use super::*;

    #[test]
    fn the_first_installed_default_wins() {
        let applications = written(&[
            ("second.desktop", &handler("second %u", "x-other")),
            ("third.desktop", &handler("third %u", "x-other")),
        ]);
        let config = written(&[
            (
                "first.list",
                &list("Default Applications", "missing.desktop;second.desktop"),
            ),
            (
                "second.list",
                &list("Default Applications", "third.desktop"),
            ),
        ]);

        assert_eq!(
            opened(
                config.path(),
                &["first.list", "second.list"],
                applications.path()
            ),
            Some(vec!["second".into(), "mailto:a@example.com".into()])
        );
    }

    #[test]
    fn without_a_default_an_added_association_is_next() {
        let applications = written(&[
            ("added.desktop", &handler("added %u", "x-other")),
            (
                "declared.desktop",
                &handler("declared %u", "x-scheme-handler/mailto"),
            ),
        ]);
        let config = written(&[(
            "mimeapps.list",
            &list("Added Associations", "added.desktop"),
        )]);

        assert_eq!(
            opened(config.path(), &["mimeapps.list"], applications.path()),
            Some(vec!["added".into(), "mailto:a@example.com".into()])
        );
    }

    #[test]
    fn without_a_list_an_entry_that_declares_the_type_opens_it() {
        let applications = written(&[
            ("a-other.desktop", &handler("other %u", "x-other")),
            (
                "b-mail.desktop",
                &handler("mail %u", "x-scheme-handler/mailto"),
            ),
            (
                "c-mail.desktop",
                &handler("later %u", "x-scheme-handler/mailto"),
            ),
        ]);
        let config = written(&[]);

        assert_eq!(
            opened(config.path(), &["absent.list"], applications.path()),
            Some(vec!["mail".into(), "mailto:a@example.com".into()])
        );
    }

    #[test]
    fn a_removed_association_is_not_a_handler() {
        let applications = written(&[(
            "mail.desktop",
            &handler("mail %u", "x-scheme-handler/mailto"),
        )]);
        let config = written(&[(
            "mimeapps.list",
            &list("Removed Associations", "mail.desktop"),
        )]);

        assert_eq!(
            opened(config.path(), &["mimeapps.list"], applications.path()),
            None
        );
    }

    #[test]
    fn a_hidden_entry_is_not_a_handler_but_one_not_displayed_is() {
        let applications = written(&[
            (
                "a-hidden.desktop",
                &format!(
                    "{}Hidden=true\n",
                    handler("hidden %u", "x-scheme-handler/mailto")
                ),
            ),
            (
                "b-quiet.desktop",
                &format!(
                    "{}NoDisplay=true\n",
                    handler("quiet %u", "x-scheme-handler/mailto")
                ),
            ),
        ]);
        let config = written(&[]);

        assert_eq!(
            opened(config.path(), &[], applications.path()),
            Some(vec!["quiet".into(), "mailto:a@example.com".into()])
        );
    }
}

mod commands {
    use super::*;

    /// The command a handler whose `Exec` is `exec` runs for
    /// `mailto:a@example.com`.
    fn run(exec: &str) -> Option<Vec<String>> {
        let applications = written(&[("mail.desktop", &handler(exec, "x-scheme-handler/mailto"))]);
        default_handler(
            "x-scheme-handler/mailto",
            &[],
            &[applications.path().to_path_buf()],
        )
        .expect("a handler")
        .command("mailto:a@example.com")
    }

    #[test]
    fn the_url_takes_the_place_of_its_field_code_and_others_are_dropped() {
        assert_eq!(
            run("mail --compose=%u --ratio=50%% %i %c %k"),
            Some(vec![
                "mail".into(),
                "--compose=mailto:a@example.com".into(),
                "--ratio=50%".into(),
            ])
        );
        assert_eq!(
            run("mail %U"),
            Some(vec!["mail".into(), "mailto:a@example.com".into()])
        );
    }

    #[test]
    fn a_command_with_no_url_code_gets_the_url_last() {
        // As GIO does, so a handler that forgot `%u` still gets the URL.
        assert_eq!(
            run("mail --new %f"),
            Some(vec![
                "mail".into(),
                "--new".into(),
                "mailto:a@example.com".into()
            ])
        );
    }

    #[test]
    fn quoting_and_escapes_are_read_in_the_specs_order() {
        // `\s` escapes a space and `\\` a backslash; inside quotes the result
        // then escapes the next character.
        assert_eq!(
            run(r#""/opt/My App/run" a\sb "c\\\\d" %u"#),
            Some(vec![
                "/opt/My App/run".into(),
                "a".into(),
                "b".into(),
                r"c\d".into(),
                "mailto:a@example.com".into(),
            ])
        );
    }

    #[test]
    fn a_command_that_cannot_be_read_is_nothing() {
        assert_eq!(run(r#"mail "unterminated"#), None);
    }
}

mod finding_the_lists {
    use super::*;

    #[test]
    fn config_lists_come_before_data_lists_and_the_desktops_own_before_the_shared() {
        assert_eq!(
            lists(
                Some(OsString::from("/home/u/.config")),
                Some(OsString::from("/etc/xdg:/opt/xdg")),
                &[PathBuf::from("/home/u/.local/share/applications")],
                None,
                "domicile",
            ),
            [
                "/home/u/.config/domicile-mimeapps.list",
                "/home/u/.config/mimeapps.list",
                "/etc/xdg/domicile-mimeapps.list",
                "/etc/xdg/mimeapps.list",
                "/opt/xdg/domicile-mimeapps.list",
                "/opt/xdg/mimeapps.list",
                "/home/u/.local/share/applications/domicile-mimeapps.list",
                "/home/u/.local/share/applications/mimeapps.list",
            ]
            .map(PathBuf::from)
        );
    }

    #[test]
    fn unset_config_directories_are_the_specs_defaults() {
        assert_eq!(
            lists(
                None,
                Some(OsString::new()),
                &[],
                Some(Path::new("/home/u")),
                "domicile"
            ),
            [
                "/home/u/.config/domicile-mimeapps.list",
                "/home/u/.config/mimeapps.list",
                "/etc/xdg/domicile-mimeapps.list",
                "/etc/xdg/mimeapps.list",
            ]
            .map(PathBuf::from)
        );
    }
}
