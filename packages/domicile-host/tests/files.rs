//! What a launcher is offered, walked out of a filesystem that is not there.
//!
//! The rule being implemented is the one the author's own launcher has run on
//! for years — `pkgs/launcher/scripts/launch.nix` in `cprussin/dotfiles`:
//!
//! ```sh
//! find ~/* -maxdepth 1
//! find ~/{Notes,Scratch} -mindepth 2 -not -path '*/\.*'
//! ```
//!
//! piped through `sed "s|$HOME/||"` and `sort`. Two passes, because they want
//! different depths: everything at the top of home and one level into it, plus
//! the whole of the few trees a person actually keeps documents in. The tests
//! below are that rule read back as behavior, including the two places its two
//! halves disagree about hidden files — which is a quirk of the original and
//! is kept rather than tidied, because a launcher that stopped offering a path
//! it used to offer is a regression to the person typing.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use domicile_host::files::{listing, Directory};

/// The roots the tests walk deep, standing in for the desktop's own.
const ROOTS: &[&str] = &["Notes", "Scratch"];

#[test]
fn every_top_level_entry_is_offered_with_what_is_directly_inside_it() {
    // `find ~/* -maxdepth 1`: each top-level entry, and for a directory its
    // immediate children too. One level, not the whole tree — `src` is a
    // checkout of a hundred thousand files and a launcher that listed them all
    // would be a launcher nobody can type into.
    let home = home([
        ("/home/you", &["Notes", "src", "todo.txt"][..]),
        ("/home/you/Notes", &["today.org"]),
        ("/home/you/src", &["domicile"]),
        ("/home/you/src/domicile", &["README.md"]),
    ]);

    let offered = listing(Path::new("/home/you"), ROOTS, &home).expect("home reads");

    assert!(offered.contains(&"todo.txt".to_string()));
    assert!(offered.contains(&"src".to_string()));
    assert!(offered.contains(&"src/domicile".to_string()));
    // One level and no further: `src` is not a deep root.
    assert!(!offered.contains(&"src/domicile/README.md".to_string()));
}

#[test]
fn a_dotfile_at_the_top_of_home_is_not_offered_and_neither_is_its_contents() {
    // The glob is what filters here: `~/*` does not match a leading dot, so
    // `find` is never handed `~/.config` and never descends into it. That is
    // the whole of the hidden-file rule for this half of the walk.
    let home = home([
        ("/home/you", &[".config", "src"][..]),
        ("/home/you/.config", &["domicile"]),
        ("/home/you/src", &["domicile"]),
    ]);

    let offered = listing(Path::new("/home/you"), ROOTS, &home).expect("home reads");

    assert_eq!(offered, vec!["src".to_string(), "src/domicile".to_string()]);
}

#[test]
fn a_deep_root_is_walked_all_the_way_down() {
    // `find ~/Notes -mindepth 2`, which is what takes the walk past the one
    // level the first pass stops at. The depths below it — `Notes` itself and
    // `Notes/2026` — are the first pass's, so the two together are the whole
    // tree with nothing counted twice.
    let home = home([
        ("/home/you", &["Notes"][..]),
        ("/home/you/Notes", &["2026"]),
        ("/home/you/Notes/2026", &["april"]),
        ("/home/you/Notes/2026/april", &["plan.org"]),
    ]);

    let offered = listing(Path::new("/home/you"), ROOTS, &home).expect("home reads");

    assert_eq!(
        offered,
        vec![
            "Notes".to_string(),
            "Notes/2026".to_string(),
            "Notes/2026/april".to_string(),
            "Notes/2026/april/plan.org".to_string(),
        ]
    );
}

#[test]
fn the_two_passes_disagree_about_a_hidden_directory_and_that_is_the_original() {
    // `-not -path '*/\.*'` prunes nothing at depth one, because depth one is
    // the *first* pass's and that pass filters with a glob on home alone. So
    // `Notes/.git` is offered and everything under it is not. Faithful to the
    // script, and the asymmetry is the reason this test exists rather than a
    // comment: somebody tidying one half to match the other would be changing
    // what the launcher offers.
    let home = home([
        ("/home/you", &["Notes"][..]),
        ("/home/you/Notes", &[".git", "today.org"]),
        ("/home/you/Notes/.git", &["HEAD"]),
    ]);

    let offered = listing(Path::new("/home/you"), ROOTS, &home).expect("home reads");

    assert!(offered.contains(&"Notes/.git".to_string()));
    assert!(!offered.contains(&"Notes/.git/HEAD".to_string()));
}

#[test]
fn the_answer_is_sorted_and_named_from_home() {
    // Sorted because `sort` is the last thing in the pipe, and byte order
    // because that is what a launcher wants: the same list in the same order
    // on every machine, rather than one that moves with `LC_COLLATE`.
    //
    // Relative because the home directory is the part every row shares, and a
    // list that repeats it on every row is a list you read past rather than
    // read.
    let home = home([
        ("/home/you", &["src", "Notes", "todo.txt"][..]),
        ("/home/you/Notes", &[]),
        ("/home/you/src", &[]),
    ]);

    let offered = listing(Path::new("/home/you"), ROOTS, &home).expect("home reads");

    assert_eq!(
        offered,
        vec![
            "Notes".to_string(),
            "src".to_string(),
            "todo.txt".to_string()
        ]
    );
}

#[test]
fn a_deep_root_nobody_has_is_not_a_failure() {
    // `Scratch` is a directory the desktop names and a person may never have
    // made. `find` prints a complaint and carries on, and so does this: a home
    // without one is a home with fewer files in it, not a launcher that
    // refuses to open.
    let home = home([("/home/you", &["todo.txt"][..])]);

    let offered = listing(Path::new("/home/you"), ROOTS, &home).expect("home reads");

    assert_eq!(offered, vec!["todo.txt".to_string()]);
}

#[test]
fn a_home_that_cannot_be_read_is_a_failure_rather_than_an_empty_list() {
    // The one error this walk does not absorb. Everywhere else an unreadable
    // path is a leaf — that is what a plain file is — but a home directory
    // that will not open is a broken desktop, and answering it with "you have
    // no files" would be that breakage wearing a normal face.
    let nothing = home([]);

    let refused = listing(Path::new("/home/you"), ROOTS, &nothing);

    assert!(refused.is_err());
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
