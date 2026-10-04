//! The home directory walk that builds the file index, over a fake
//! filesystem.
//!
//! The walk has no depth limit: it runs once at boot, and a watcher keeps the
//! index current. Paths matching `files.omit` are not offered and not
//! descended into. The default config omits hidden paths.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use domicile_host::home_walk::{walk, walk_within, Directory, Entry};

#[test]
fn every_path_under_home_is_found_at_every_depth() {
    // `src/domicile/README.md` is four levels down, so a depth limit would
    // miss it.
    let home = home([
        ("/home/you", &["Notes/", "src/", "todo.txt"][..]),
        ("/home/you/Notes", &["today.org"]),
        ("/home/you/src", &["domicile/"]),
        ("/home/you/src/domicile", &["README.md"]),
    ]);

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(
        found,
        vec![
            "Notes".to_string(),
            "src".to_string(),
            "todo.txt".to_string(),
            "Notes/today.org".to_string(),
            "src/domicile".to_string(),
            "src/domicile/README.md".to_string(),
        ]
    );
}

#[test]
fn the_shallow_paths_come_first_because_a_half_built_index_is_read() {
    // Breadth first, because the launcher can open mid-walk and shows what
    // has been found so far. Top-level directories like `~/Notes` and `~/src`
    // appear first, and deeper paths fill in.
    let home = home([
        ("/home/you", &["deep/", "shallow.txt"][..]),
        ("/home/you/deep", &["down/"]),
        ("/home/you/deep/down", &["here.txt"]),
    ]);

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(
        found,
        vec![
            "deep".to_string(),
            "shallow.txt".to_string(),
            "deep/down".to_string(),
            "deep/down/here.txt".to_string(),
        ]
    );
}

#[test]
fn an_omitted_entry_is_neither_offered_nor_walked_at_any_depth() {
    // `files.omit` decides, by path relative to the home. An omitted directory
    // is not descended into, since omits target large trees like `~/Library` or
    // `target/`. Hidden paths are omitted by the config's default, not by the
    // walk.
    let home = home([
        ("/home/you", &[".config/", "src/"][..]),
        ("/home/you/.config", &["domicile"]),
        ("/home/you/src", &["main.rs", "target/"]),
        ("/home/you/src/target", &["debug"]),
    ]);

    let found: Vec<String> = walk(Path::new("/home/you"), &home, &|path: &str| {
        path == "src/target"
    })
    .expect("home reads")
    .collect();

    assert_eq!(
        found,
        vec![
            ".config".to_string(),
            "src".to_string(),
            ".config/domicile".to_string(),
            "src/main.rs".to_string(),
        ]
    );
}

#[test]
fn a_walk_within_the_home_names_and_omits_as_one_of_all_of_it_would() {
    // The compositor's `file_indexing` walks a directory that appears under a
    // watch with this, so it must name and omit paths as the boot walk does.
    let home = home([
        ("/home/you/src", &["new/"][..]),
        ("/home/you/src/new", &["main.rs", "target/"]),
        ("/home/you/src/new/target", &["debug"]),
    ]);

    let found: Vec<String> =
        walk_within(Path::new("/home/you"), "src/new", &home, &|path: &str| {
            path == "src/new/target"
        })
        .expect("the directory reads")
        .collect();

    assert_eq!(found, vec!["src/new/main.rs".to_string()]);
}

#[test]
fn a_directory_that_will_not_open_is_a_leaf_rather_than_a_failure() {
    // A permission error on one subdirectory: the path is still offered, and
    // the walk continues.
    let home = home([
        ("/home/you", &["locked/", "todo.txt"][..]),
        // `locked` has no entry, so reading it fails.
    ]);

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(found, vec!["locked".to_string(), "todo.txt".to_string()]);
}

#[test]
fn only_a_directory_is_walked_so_a_link_is_offered_but_not_followed() {
    // A link is offered by name but not followed. A `nix build` `result` or a
    // `node_modules` link farm would otherwise walk other trees or loop.
    let home = home([
        ("/home/you", &["result", "src/"][..]),
        ("/home/you/result", &["bin/"]),
        ("/home/you/result/bin", &["hello"]),
        ("/home/you/src", &["main.rs"]),
    ]);

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(
        found,
        vec![
            "result".to_string(),
            "src".to_string(),
            "src/main.rs".to_string(),
        ]
    );
}

#[test]
fn a_home_that_cannot_be_read_is_a_failure_rather_than_an_empty_walk() {
    // An unreadable home is an error, not an empty list, which would look
    // like a home with no files. The compositor logs it and leaves the launcher
    // without a list.
    let nothing = home([]);

    let refused = walk(Path::new("/home/you"), &nothing, &nothing_omitted);

    assert!(refused.is_err());
}

#[test]
fn a_name_that_is_not_text_is_left_out_rather_than_ending_the_walk() {
    // A name that is not valid UTF-8 cannot be sent as text. It is skipped,
    // and the walk continues.
    let home = FakeHome {
        entries: BTreeMap::from([(
            PathBuf::from("/home/you"),
            vec![
                Entry {
                    path: not_text("/home/you"),
                    directory: false,
                },
                Entry {
                    path: PathBuf::from("/home/you/todo.txt"),
                    directory: false,
                },
            ],
        )]),
    };

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(found, vec!["todo.txt".to_string()]);
}

/// Every path the walk finds, in walk order.
fn found(home: &Path, directory: &FakeHome) -> Vec<String> {
    walk(home, directory, &nothing_omitted)
        .expect("home reads")
        .collect()
}

/// An omit rule that omits nothing.
fn nothing_omitted(_: &str) -> bool {
    false
}

/// A fake filesystem holding only the named directories.
///
/// A name ending in `/` is a directory. Reading a path with no entry fails,
/// like an unreadable directory.
fn home<'a>(tree: impl IntoIterator<Item = (&'a str, &'a [&'a str])>) -> FakeHome {
    FakeHome {
        entries: tree
            .into_iter()
            .map(|(path, names)| {
                let path = PathBuf::from(path);
                let children = names
                    .iter()
                    .map(|name| match name.strip_suffix('/') {
                        Some(name) => Entry {
                            path: path.join(name),
                            directory: true,
                        },
                        None => Entry {
                            path: path.join(name),
                            directory: false,
                        },
                    })
                    .collect();
                (path, children)
            })
            .collect(),
    }
}

/// A child of `parent` whose name is not valid UTF-8.
fn not_text(parent: &str) -> PathBuf {
    use std::os::unix::ffi::OsStrExt;
    Path::new(parent).join(std::ffi::OsStr::from_bytes(&[0xff, 0xfe]))
}

struct FakeHome {
    entries: BTreeMap<PathBuf, Vec<Entry>>,
}

impl Directory for FakeHome {
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>> {
        self.entries.get(path).cloned().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("no {}", path.display()))
        })
    }
}
