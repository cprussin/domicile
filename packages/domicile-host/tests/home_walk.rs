//! The walk the index is built out of, taken over a filesystem that is not there.
//!
//! What it replaces is the two-pass `find` the launcher used to be answered
//! from — everything at the top of home plus one level, and `Notes` and
//! `Scratch` the rest of the way down. That rule existed because the walk ran
//! on every keystroke's worth of panel opening and had to be cheap. It is not
//! that any more: this runs once at boot into an index a watcher then keeps,
//! so the depth limit and the two hand-picked roots buy nothing and cost a
//! launcher that cannot find a file three directories down.
//!
//! What is left out is the desk's to say — `[files] omit` in its config — and
//! is kept whole at every depth: an omitted path is not offered and nothing
//! under it is walked. The config's default omits whatever is hidden, since a
//! launcher that offered `src/.git/objects/4a/…` would be a launcher with a
//! hundred thousand rows nobody will ever type.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use domicile_host::home_walk::{walk, walk_within, Directory};

#[test]
fn every_path_under_home_is_found_at_every_depth() {
    // The whole point of the change: `src/domicile/README.md` is four levels
    // down and the old walk stopped at two, so a person who typed `README`
    // was told their home had no such file.
    let home = home([
        ("/home/you", &["Notes", "src", "todo.txt"][..]),
        ("/home/you/Notes", &["today.org"]),
        ("/home/you/src", &["domicile"]),
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
    // BREADTH FIRST, AND IT IS THE LAUNCHER THAT ASKS FOR IT. The panel can be
    // opened while the walk is still running, and what it shows then is
    // whatever has been found so far — so the order the walk finds things in
    // is the order a person gets them. Depth first would hand them the whole
    // of the first directory in `~` before the second one existed at all; this
    // way `~/Notes` and `~/src` are there from the first moment and the deep
    // paths fill in under them.
    let home = home([
        ("/home/you", &["deep", "shallow.txt"][..]),
        ("/home/you/deep", &["down"]),
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
    // Which entries is the desk's to say — `[files] omit` in its config — and
    // the walk asks of every one it meets, by its name relative to the home.
    // Not walked, because what an omit is *for* is a `~/Library` or a
    // `target/` too big to be worth reading. A dot is nothing special here:
    // hiding those is the config's default, not the walk's rule.
    let home = home([
        ("/home/you", &[".config", "src"][..]),
        ("/home/you/.config", &["domicile"]),
        ("/home/you/src", &["main.rs", "target"]),
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
    // What a directory that turns up under a watch is walked with — see the
    // compositor's `file_indexing` — so the rows it adds have to be the rows a
    // boot walk would have found there, named from the home and omitted by
    // the same rule.
    let home = home([
        ("/home/you/src", &["new"][..]),
        ("/home/you/src/new", &["main.rs", "target"]),
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
    // Which is what a plain file is — nothing in a directory listing says
    // which of its entries can be read as one, so the walk finds out by
    // asking. A permission denied on one subdirectory of a home is the same
    // shape and gets the same answer: the path is still offered, and the walk
    // carries on with the rest of the home rather than stopping on it.
    let home = home([
        ("/home/you", &["locked", "todo.txt"][..]),
        // `locked` names no entry of its own, so reading it fails.
    ]);

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(found, vec!["locked".to_string(), "todo.txt".to_string()]);
}

#[test]
fn a_home_that_cannot_be_read_is_a_failure_rather_than_an_empty_walk() {
    // The one error the walk does not absorb, and it is absorbed nowhere else
    // either: a home directory that will not open is a broken desktop, and an
    // index built from it would say "you have no files" in a voice
    // indistinguishable from a home with none. The compositor logs this and
    // leaves the launcher without a list, which is the state the panel can
    // still be typed a path into.
    let nothing = home([]);

    let refused = walk(Path::new("/home/you"), &nothing, &nothing_omitted);

    assert!(refused.is_err());
}

#[test]
fn a_name_that_is_not_text_is_left_out_rather_than_ending_the_walk() {
    // The one failure a real `read_dir` produces that a table cannot: the
    // kernel stores bytes and a launcher draws text. A path that cannot be
    // spelled is a path that cannot be offered, and the rest of the home is
    // still worth having.
    let home = FakeHome {
        entries: BTreeMap::from([(
            PathBuf::from("/home/you"),
            vec![not_text("/home/you"), PathBuf::from("/home/you/todo.txt")],
        )]),
    };

    let found = found(Path::new("/home/you"), &home);

    assert_eq!(found, vec!["todo.txt".to_string()]);
}

/// Everything the walk finds, in the order it finds it.
fn found(home: &Path, directory: &FakeHome) -> Vec<String> {
    walk(home, directory, &nothing_omitted)
        .expect("home reads")
        .collect()
}

/// A desk that omits nothing from its index.
fn nothing_omitted(_: &str) -> bool {
    false
}

/// A filesystem of exactly the directories named, and nothing else.
///
/// Anything absent reads as "not a directory", which is what a plain file is:
/// `todo.txt` in the tables above is a leaf precisely because no entry names
/// its contents.
fn home<'a>(tree: impl IntoIterator<Item = (&'a str, &'a [&'a str])>) -> FakeHome {
    FakeHome {
        entries: tree
            .into_iter()
            .map(|(path, names)| {
                let path = PathBuf::from(path);
                let children = names.iter().map(|name| path.join(name)).collect();
                (path, children)
            })
            .collect(),
    }
}

/// A child of `parent` whose name is bytes no `str` can hold.
fn not_text(parent: &str) -> PathBuf {
    use std::os::unix::ffi::OsStrExt;
    Path::new(parent).join(std::ffi::OsStr::from_bytes(&[0xff, 0xfe]))
}

struct FakeHome {
    entries: BTreeMap<PathBuf, Vec<PathBuf>>,
}

impl Directory for FakeHome {
    fn read(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
        self.entries.get(path).cloned().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("no {}", path.display()))
        })
    }
}
