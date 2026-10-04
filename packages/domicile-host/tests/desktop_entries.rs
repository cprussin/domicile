//! Installed applications offered to the launcher.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use domicile_host::desktop_entries::{
    application_dirs, command, data_dirs, find, installed, parse, Entry,
};
use domicile_protocol::DesktopEntry;

/// An application directory holding `entries`, as relative paths and text.
fn applications(entries: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a directory to write in");
    for (path, text) in entries {
        let at = dir.path().join(path);
        fs::create_dir_all(at.parent().expect("a parent")).unwrap();
        fs::write(at, text).unwrap();
    }
    dir
}

fn entry(name: &str, exec: &str) -> String {
    format!("[Desktop Entry]\nType=Application\nName={name}\nExec={exec}\n")
}

fn names<'a>(found: &[&'a Entry]) -> Vec<&'a str> {
    found
        .iter()
        .map(|found| found.entry.name.as_str())
        .collect()
}

mod parsing {
    use super::*;

    #[test]
    fn an_application_is_its_name_comment_and_command() {
        let parsed = parse(
            "firefox.desktop",
            "# a comment\n\
             [Desktop Entry]\n\
             Type=Application\n\
             Name=Firefox\n\
             Name[de]=Feuerfuchs\n\
             Comment = Browse the web\n\
             Exec=firefox %u\n\
             Icon=firefox\n\
             X-Domicile-Preview=/usr/share/firefox/preview.svg\n\
             [Desktop Action new-window]\n\
             Name=New Window\n\
             Exec=firefox --new-window\n",
        )
        .expect("an application");

        assert_eq!(
            parsed.entry,
            DesktopEntry {
                id: "firefox.desktop".into(),
                name: "Firefox".into(),
                comment: "Browse the web".into(),
                command: vec!["firefox".into()],
                icon: None,
                preview: None,
            }
        );
        assert_eq!(parsed.icon_name(), Some("firefox"));
        assert_eq!(
            parsed.preview_name(),
            Some("/usr/share/firefox/preview.svg")
        );
    }

    #[test]
    fn an_entry_a_launcher_should_not_offer_is_nothing() {
        for (why, text) in [
            (
                "a link",
                "[Desktop Entry]\nType=Link\nName=Docs\nURL=https://a\n",
            ),
            ("hidden", &format!("{}Hidden=true\n", entry("A", "a"))),
            (
                "not displayed",
                &format!("{}NoDisplay=true\n", entry("A", "a")),
            ),
            // The compositor does not know which terminal to use.
            (
                "in a terminal",
                &format!("{}Terminal=true\n", entry("A", "a")),
            ),
            ("nameless", "[Desktop Entry]\nType=Application\nExec=a\n"),
            (
                "nothing to run",
                "[Desktop Entry]\nType=Application\nName=A\n",
            ),
            ("outside the group", "Type=Application\nName=A\nExec=a\n"),
        ] {
            assert!(parse("a.desktop", text).is_none(), "{why}");
        }
    }
}

mod commands {
    use super::*;

    #[test]
    fn field_codes_are_dropped_and_a_percent_is_kept() {
        assert_eq!(
            command("app %F --ratio=50%% %i %c %k"),
            Some(vec!["app".into(), "--ratio=50%".into()])
        );
    }

    #[test]
    fn a_quoted_argument_is_one_word() {
        assert_eq!(
            command(r#""/opt/My App/run" --title "say \"hi\" for \$5""#),
            Some(vec![
                "/opt/My App/run".into(),
                "--title".into(),
                r#"say "hi" for $5"#.into(),
            ])
        );
    }

    #[test]
    fn a_string_escape_is_read_before_the_quoting() {
        // `\s` escapes a space and `\\` a backslash; inside quotes the result
        // then escapes the next character.
        assert_eq!(
            command(r#"a\sb "c\\\\d""#),
            Some(vec!["a".into(), "b".into(), r"c\d".into()])
        );
    }

    #[test]
    fn a_command_that_cannot_be_read_is_nothing() {
        assert_eq!(command(r#"app "unterminated"#), None);
        assert_eq!(command("%U"), None);
    }
}

mod directories {
    use super::*;

    #[test]
    fn the_data_home_comes_before_the_data_dirs() {
        assert_eq!(
            application_dirs(
                Some(OsString::from("/data/home")),
                Some(OsString::from("/a/share:/b/share")),
                Some(Path::new("/home/you")),
            ),
            vec![
                PathBuf::from("/data/home/applications"),
                PathBuf::from("/a/share/applications"),
                PathBuf::from("/b/share/applications"),
            ]
        );
    }

    #[test]
    fn the_data_directories_are_the_same_list_without_applications() {
        assert_eq!(
            data_dirs(
                Some(OsString::from("/data/home")),
                Some(OsString::from("/a/share")),
                None,
            ),
            vec![PathBuf::from("/data/home"), PathBuf::from("/a/share")]
        );
    }

    #[test]
    fn with_no_home_and_no_data_home_there_is_no_data_home() {
        assert_eq!(
            application_dirs(None, Some(OsString::from("/a/share")), None),
            vec![PathBuf::from("/a/share/applications")]
        );
    }

    #[test]
    fn unset_or_empty_variables_are_the_specs_defaults() {
        let expected = vec![
            PathBuf::from("/home/you/.local/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
            PathBuf::from("/usr/share/applications"),
        ];
        assert_eq!(
            application_dirs(None, None, Some(Path::new("/home/you"))),
            expected
        );
        assert_eq!(
            application_dirs(
                Some(OsString::new()),
                Some(OsString::new()),
                Some(Path::new("/home/you"))
            ),
            expected
        );
    }
}

mod installing {
    use super::*;

    #[test]
    fn an_id_is_the_path_under_applications_with_dashes() {
        let dir = applications(&[("kde/konsole.desktop", &entry("Konsole", "konsole"))]);

        let found = installed(&[dir.path().to_path_buf()]);

        assert_eq!(found[0].entry.id, "kde-konsole.desktop");
    }

    #[test]
    fn an_earlier_directory_overrides_a_later_one_even_to_hide_it() {
        let user = applications(&[
            ("editor.desktop", &entry("My Editor", "my-editor")),
            (
                "clock.desktop",
                &format!("{}NoDisplay=true\n", entry("Clock", "clock")),
            ),
        ]);
        let system = applications(&[
            ("editor.desktop", &entry("Editor", "editor")),
            ("clock.desktop", &entry("Clock", "clock")),
            ("notes.txt", "not an entry"),
        ]);

        let found = installed(&[
            user.path().to_path_buf(),
            PathBuf::from("/does/not/exist"),
            system.path().to_path_buf(),
        ]);

        assert_eq!(
            found
                .iter()
                .map(|found| found.entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["My Editor"]
        );
    }
}

mod finding {
    use super::*;

    fn offered() -> Vec<domicile_host::desktop_entries::Entry> {
        [
            entry("Text Editor", "gedit"),
            format!(
                "{}GenericName=Web Browser\nKeywords=internet;www;\n",
                entry("Firefox", "firefox")
            ),
            entry("Files", "nautilus"),
            entry("Terminal Fire Drill", "drill"),
        ]
        .iter()
        .enumerate()
        .map(|(n, text)| parse(&format!("{n}.desktop"), text).expect("an application"))
        .collect()
    }

    #[test]
    fn every_word_matches_a_name_generic_name_or_keyword_ignoring_case() {
        assert_eq!(names(&find(&offered(), "WEB browser", 10)), vec!["Firefox"]);
        assert_eq!(names(&find(&offered(), "www", 10)), vec!["Firefox"]);
        assert!(find(&offered(), "fire nope", 10).is_empty());
    }

    #[test]
    fn a_name_that_starts_with_the_query_comes_first_then_by_name() {
        assert_eq!(
            names(&find(&offered(), "fi", 10)),
            vec!["Files", "Firefox", "Terminal Fire Drill"]
        );
    }

    #[test]
    fn no_more_than_the_limit_is_offered() {
        assert_eq!(names(&find(&offered(), "", 2)), vec!["Files", "Firefox"]);
    }
}
