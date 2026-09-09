//! A shell is named or it is a path to a module, and which one it is has rules.

use std::path::{Path, PathBuf};

use domicile_launch::shell_path::{shell_module, ShellPathError};

/// A tiny filesystem: `Some(true)` a directory, `Some(false)` a file, `None`
/// absent. Injected so these rules are testable without a temp directory,
/// which is the whole reason they are here rather than in the supervisor.
fn tree(entries: &'static [(&'static str, bool)]) -> impl Fn(&Path) -> Option<bool> {
    move |path| {
        entries
            .iter()
            .find(|(name, _)| Path::new(name) == path)
            .map(|(_, is_dir)| *is_dir)
    }
}

#[test]
fn the_module_named_is_the_module_loaded_and_its_directory_is_served() {
    // THE BUG THIS REPLACED. The argument used to name a *directory* — a file
    // was taken as the directory holding it — and then `<directory>/shell.js`
    // was what got loaded. So `domicile /d/dist/other.js` started a desktop on
    // `/d/dist/shell.js`: a different file than the one on the command line,
    // silently, and the run's own "shell:" line named the directory and so
    // agreed with both. A `shell.js` sitting beside the module named here is
    // what made that go unnoticed, so it is in this tree.
    let fs = tree(&[
        ("/d/dist", true),
        ("/d/dist/shell.js", false),
        ("/d/dist/other.js", false),
    ]);
    let shell = shell_module("/d/dist/other.js", None, &fs).unwrap();
    assert_eq!(shell.root, PathBuf::from("/d/dist"));
    assert_eq!(shell.module, PathBuf::from("other.js"));
}

#[test]
fn a_module_with_no_directory_in_front_of_it_is_served_from_here() {
    // `domicile shell.js`, standing in the build. `Path::parent` of a path
    // with one component is the *empty* path rather than nothing, and an empty
    // `--domicile-shell-root=` names no directory at all — the engine would be
    // told to serve "" and the desktop would come up on nothing. Where the
    // user was standing is what they meant.
    let fs = tree(&[("shell.js", false)]);
    let shell = shell_module("shell.js", None, &fs).unwrap();
    assert_eq!(shell.root, PathBuf::from("."));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_directory_is_refused_and_says_which_file_to_name() {
    // The old command line *was* a directory, so this is the message the
    // people who have that one in their fingers will read: it has to say what
    // to type instead rather than only what was wrong. Refused rather than
    // searched, because which module a directory holds is the shell's business
    // and guessing at it is what produced the bug above.
    let fs = tree(&[("./dist", true), ("./dist/shell.js", false)]);
    assert_eq!(
        shell_module("./dist", None, &fs),
        Err(ShellPathError::Directory("./dist".to_string()))
    );
}

#[test]
fn a_handed_in_module_makes_a_bare_name_a_name() {
    // A packaged desktop hands over the module it built and passes its own
    // name along for the log. Run from a directory that happens to contain a
    // `simple/`, that word must not become a path — the user's own `cd` is not
    // an argument.
    let fs = tree(&[("simple", true), ("/store/page/shell.js", false)]);
    let shell = shell_module("simple", Some("/store/page/shell.js"), &fs).unwrap();
    assert_eq!(shell.root, PathBuf::from("/store/page"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_slash_is_still_a_path_even_then() {
    // A handed-in module and a path really are two answers to one question,
    // and this is the case that refusal was written for.
    let fs = tree(&[("./dist/shell.js", false), ("/store/page/shell.js", false)]);
    assert_eq!(
        shell_module("./dist/shell.js", Some("/store/page/shell.js"), &fs),
        Err(ShellPathError::TwoPages {
            page: "/store/page/shell.js".to_string(),
            argument: "./dist/shell.js".to_string(),
        })
    );
}

#[test]
fn a_bare_name_with_no_module_behind_it_is_not_a_shell() {
    // The binary builds nothing, so a name on its own names nothing it could
    // serve. Refused as a path that is not there, which is what it is.
    let fs = tree(&[]);
    assert_eq!(
        shell_module("simple", None, &fs),
        Err(ShellPathError::NotThere("simple".to_string()))
    );
}

#[test]
fn a_path_to_nothing_is_refused_before_anything_starts() {
    // A typo in the path is the ordinary failure, and it is worth catching
    // here rather than at the far end: what would otherwise find it is the
    // engine, a browser start later, as a window with nothing in it.
    let fs = tree(&[("./dist", true)]);
    assert_eq!(
        shell_module("./dist/shell.js", None, &fs),
        Err(ShellPathError::NotThere("./dist/shell.js".to_string()))
    );
}
