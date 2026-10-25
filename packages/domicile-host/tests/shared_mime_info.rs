//! A file's content type and a type's supertypes, from shared-mime-info.

use std::fs;
use std::path::PathBuf;

use domicile_host::shared_mime_info::{aliases, content_type, supertypes};

/// A directory holding `files`, as relative paths and bytes.
fn written(files: &[(&str, &[u8])]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a directory to write in");
    for (path, bytes) in files {
        let at = dir.path().join(path);
        fs::create_dir_all(at.parent().expect("a parent")).unwrap();
        fs::write(at, bytes).unwrap();
    }
    dir
}

mod typing {
    use super::*;

    #[test]
    fn a_directory_is_inode_directory() {
        let home = written(&[("music/a.flac", b"")]);

        assert_eq!(
            content_type(&home.path().join("music"), &[]).unwrap(),
            "inode/directory"
        );
    }

    #[test]
    fn the_heaviest_glob_wins_then_the_longest_then_the_earliest_directory() {
        let data = written(&[
            ("early/mime/globs2", b"50:text/x-org:*.org\n"),
            (
                "late/mime/globs2",
                b"# generated\n80:text/x-heavy:*.heavy\n50:text/x-later:*.org\n50:text/x-todo:*todo.org\n",
            ),
        ]);
        let home = written(&[("todo.org", b""), ("done.org", b""), ("a.heavy", b"")]);
        let dirs = [data.path().join("early"), data.path().join("late")];
        let type_of = |name: &str| content_type(&home.path().join(name), &dirs).unwrap();

        assert_eq!(type_of("todo.org"), "text/x-todo");
        assert_eq!(type_of("done.org"), "text/x-org");
        assert_eq!(type_of("a.heavy"), "text/x-heavy");
    }

    #[test]
    fn globs_ignore_case_unless_they_say_cs() {
        let data = written(&[(
            "mime/globs2",
            b"50:text/x-c++src:*.C:cs\n50:text/x-readme:readme\n",
        )]);
        let home = written(&[("README", b"hi"), ("main.c", b"\0binary")]);
        let dirs = [data.path().to_path_buf()];

        assert_eq!(
            content_type(&home.path().join("README"), &dirs).unwrap(),
            "text/x-readme"
        );
        assert_eq!(
            content_type(&home.path().join("main.c"), &dirs).unwrap(),
            "application/octet-stream"
        );
    }

    #[test]
    fn a_name_no_glob_matches_is_text_or_bytes_by_its_contents() {
        let home = written(&[
            ("notes", "ünïcode text\n".as_bytes()),
            ("empty", b""),
            ("blob", b"\x7fELF\0\0"),
        ]);
        let type_of = |name: &str| content_type(&home.path().join(name), &[]).unwrap();

        assert_eq!(type_of("notes"), "text/plain");
        assert_eq!(type_of("empty"), "text/plain");
        assert_eq!(type_of("blob"), "application/octet-stream");
    }

    #[test]
    fn control_characters_are_not_text_but_whitespace_is() {
        let home = written(&[("tabs", b"a\tb\r\n\x0c\x0b"), ("escape", b"\x1b[1mbold")]);
        let type_of = |name: &str| content_type(&home.path().join(name), &[]).unwrap();

        assert_eq!(type_of("tabs"), "text/plain");
        assert_eq!(type_of("escape"), "application/octet-stream");
    }

    #[test]
    fn utf8_cut_off_only_where_the_read_stopped_is_text() {
        let mut long = vec![b'a'; 4095];
        long.push(0xc3);
        let home = written(&[("long", &long), ("short", b"abc\xc3")]);
        let type_of = |name: &str| content_type(&home.path().join(name), &[]).unwrap();

        assert_eq!(type_of("long"), "text/plain");
        assert_eq!(type_of("short"), "application/octet-stream");
    }

    #[test]
    fn a_fifo_is_typed_without_being_read() {
        let home = written(&[]);
        let fifo = home.path().join("pipe");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo to run");
        assert!(made.success());

        assert_eq!(content_type(&fifo, &[]).unwrap(), "inode/fifo");
    }

    #[test]
    fn noglobs_drops_a_types_globs_from_later_directories() {
        let data = written(&[
            (
                "early/mime/globs2",
                b"50:text/x-old:__NOGLOBS__\n50:text/x-new:*.new\n",
            ),
            (
                "late/mime/globs2",
                b"50:text/x-old:*.old\n50:text/x-new:*.old\n",
            ),
        ]);
        let home = written(&[("a.old", b"\0")]);
        let dirs = [data.path().join("early"), data.path().join("late")];

        assert_eq!(
            content_type(&home.path().join("a.old"), &dirs).unwrap(),
            "text/x-new"
        );
    }

    #[test]
    fn braces_in_a_glob_are_literal() {
        let data = written(&[(
            "mime/globs2",
            b"50:text/x-brace:*.{a,b}\n50:text/x-class:*.[{}]\n",
        )]);
        let home = written(&[("x.a", b"\0"), ("x.{a,b}", b"\0"), ("x.}", b"\0")]);
        let dirs = [data.path().to_path_buf()];
        let type_of = |name: &str| content_type(&home.path().join(name), &dirs).unwrap();

        assert_eq!(type_of("x.{a,b}"), "text/x-brace");
        assert_eq!(type_of("x.}"), "text/x-class");
        assert_eq!(type_of("x.a"), "application/octet-stream");
    }

    #[test]
    fn an_unreadable_globs2_is_an_error() {
        let data = written(&[("mime/globs2/not-a-file", b"")]);
        let home = written(&[("a.txt", b"")]);

        assert!(content_type(&home.path().join("a.txt"), &[data.path().to_path_buf()]).is_err());
    }

    #[test]
    fn a_missing_file_is_an_error() {
        let home = written(&[]);

        assert!(content_type(&home.path().join("gone"), &[]).is_err());
    }
}

mod supertypes_of {
    use super::*;

    #[test]
    fn parents_come_from_every_directory_nearest_first_each_once() {
        let data = written(&[
            (
                "early/mime/subclasses",
                b"application/x-a application/x-b\n",
            ),
            (
                "late/mime/subclasses",
                b"application/x-a text/x-c\napplication/x-b text/x-c\ntext/x-c text/plain\n",
            ),
        ]);
        let dirs: Vec<PathBuf> = vec![data.path().join("early"), data.path().join("late")];

        assert_eq!(
            supertypes("application/x-a", &dirs).unwrap(),
            ["application/x-b", "text/x-c", "text/plain"]
        );
    }

    #[test]
    fn every_other_text_type_is_a_text_plain() {
        assert_eq!(supertypes("text/markdown", &[]).unwrap(), ["text/plain"]);
        assert!(supertypes("text/plain", &[]).unwrap().is_empty());
    }

    #[test]
    fn an_unreadable_subclasses_file_is_an_error() {
        let data = written(&[("mime/subclasses/not-a-file", b"")]);

        assert!(supertypes("text/x-c", &[data.path().to_path_buf()]).is_err());
    }
}

mod aliases_of {
    use super::*;

    #[test]
    fn a_types_aliases_come_from_every_directory_in_order_each_once() {
        let data = written(&[
            (
                "early/mime/aliases",
                b"text/x-markdown text/markdown
text/x-other text/plain
",
            ),
            (
                "late/mime/aliases",
                b"text/x-web-markdown text/markdown
text/x-markdown text/markdown
",
            ),
        ]);
        let dirs: Vec<PathBuf> = vec![data.path().join("early"), data.path().join("late")];

        assert_eq!(
            aliases("text/markdown", &dirs).unwrap(),
            ["text/x-markdown", "text/x-web-markdown"]
        );
    }
}
