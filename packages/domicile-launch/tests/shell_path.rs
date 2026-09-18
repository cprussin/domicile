//! A shell is named or it is a path to a module, and which one it is has rules.

use std::path::{Path, PathBuf};

use domicile_launch::shell_path::{shell_module, ShellPathError};

/// Where these commands were typed. Absolute, because that is what
/// `current_dir` answers and what every relative path is resolved against.
const HERE: &str = "/work";

/// The home `~` stands for.
const HOME: &str = "/home/me";

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
    let shell = shell_module(
        "/d/dist/other.js",
        None,
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/d/dist"));
    assert_eq!(shell.module, PathBuf::from("other.js"));
}

#[test]
fn a_relative_path_is_resolved_against_where_it_was_typed() {
    // The engine is a child and would have inherited this directory, but the
    // answer `domicile which-shell` gives goes to processes that were started
    // somewhere else — and a run that says `shell: ./dist/shell.js` has told
    // its reader nothing they did not type. Resolved once, here, so that every
    // one of them names the same file. The `.` goes with it: it is a no-op the
    // whole line is easier to read without.
    let fs = tree(&[("/work/dist/shell.js", false)]);
    let shell = shell_module(
        "./dist/shell.js",
        None,
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/work/dist"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_module_with_no_directory_in_front_of_it_is_served_from_here() {
    // `domicile shell.js`, standing in the build. `Path::parent` of a path
    // with one component is the *empty* path rather than nothing, and an empty
    // `--domicile-shell-root=` names no directory at all — the engine would be
    // told to serve "" and the desktop would come up on nothing. Where the
    // user was standing is what they meant, and now it is what is passed on.
    let fs = tree(&[("/work/shell.js", false)]);
    let shell = shell_module(
        "shell.js",
        None,
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/work"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_tilde_is_the_home_directory() {
    // A shell expands this one before the binary ever sees it — but only when
    // there is a shell: `DOMICILE_PAGE` is written by a packaged desktop, and
    // a tilde that was quoted arrives with the tilde still on it. `~/desk` is
    // a home directory to everyone who types it, so it is one here.
    let fs = tree(&[("/home/me/desk/shell.js", false)]);
    let shell = shell_module(
        "~/desk/shell.js",
        None,
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/home/me/desk"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_bare_tilde_is_a_path_and_a_home_directory_is_not_a_shell() {
    // A `~` on its own has no separator in it, so the rule that reads a bare
    // word would have gone looking for a file called "~" and refused the
    // argument as a name nothing was handed in for. It is a path — it is only
    // ever a path — and what it names here is a directory, which is refused
    // by the rule for directories and says so.
    let fs = tree(&[("/home/me", true)]);
    assert_eq!(
        shell_module("~", None, Path::new(HERE), Some(Path::new(HOME)), &fs),
        Err(ShellPathError::Directory("/home/me".to_string()))
    );
}

#[test]
fn a_tilde_with_no_home_behind_it_is_refused() {
    // HOME unset is a login shell's business and not this program's to guess
    // at: the alternatives are a path relative to wherever the desktop was
    // started, or `/`, and a desktop that came up on either would have been
    // told to by nobody.
    let fs = tree(&[("/home/me/desk/shell.js", false)]);
    assert_eq!(
        shell_module("~/desk/shell.js", None, Path::new(HERE), None, &fs),
        Err(ShellPathError::NoHome("~/desk/shell.js".to_string()))
    );
}

#[test]
fn a_tilde_that_names_somebody_else_is_left_alone() {
    // `~alice` is the login shell's lookup of another user's home directory,
    // and this program does not have one. So the tilde is part of the name
    // rather than a home directory — and the refusal below names the path it
    // looked at, which is where the tilde is still visible.
    let fs = tree(&[]);
    assert_eq!(
        shell_module(
            "~alice/desk/shell.js",
            None,
            Path::new(HERE),
            Some(Path::new(HOME)),
            &fs
        ),
        Err(ShellPathError::NotThere(
            "/work/~alice/desk/shell.js".to_string()
        ))
    );
}

#[test]
fn a_dot_dot_is_left_for_the_filesystem_to_resolve() {
    // Popping the component in front of a `..` is only the same directory when
    // that component is not a symlink, and a shell built into one is ordinary.
    // Guessing wrong would serve a directory nobody named, which is the bug at
    // the top of `shell_path` wearing different clothes — so the `..` is
    // carried to the filesystem, which is the thing that knows.
    let fs = tree(&[("/work/dist/../other/shell.js", false)]);
    let shell = shell_module(
        "dist/../other/shell.js",
        None,
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/work/dist/../other"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_directory_is_refused_and_says_which_file_to_name() {
    // The old command line *was* a directory, so this is the message the
    // people who have that one in their fingers will read: it has to say what
    // to type instead rather than only what was wrong. Refused rather than
    // searched, because which module a directory holds is the shell's business
    // and guessing at it is what produced the bug above. The path it names is
    // the resolved one, which is the directory it actually looked at.
    let fs = tree(&[("/work/dist", true), ("/work/dist/shell.js", false)]);
    assert_eq!(
        shell_module("./dist", None, Path::new(HERE), Some(Path::new(HOME)), &fs),
        Err(ShellPathError::Directory("/work/dist".to_string()))
    );
}

#[test]
fn a_handed_in_module_makes_a_bare_name_a_name() {
    // A packaged desktop hands over the module it built and passes its own
    // name along for the log. Run from a directory that happens to contain a
    // `simple/`, that word must not become a path — the user's own `cd` is not
    // an argument.
    let fs = tree(&[("/work/simple", true), ("/store/page/shell.js", false)]);
    let shell = shell_module(
        "simple",
        Some("/store/page/shell.js"),
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/store/page"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_handed_in_module_is_resolved_by_the_same_rules() {
    // ONE RULE FOR BOTH WAYS IN. A packaged desktop writes `DOMICILE_PAGE`
    // itself, so the tilde in one is nobody's shell's to expand — and a second
    // set of rules for the way in that a user never types is the set that
    // stays broken longest.
    let fs = tree(&[("/work/simple", true), ("/home/me/store/shell.js", false)]);
    let shell = shell_module(
        "simple",
        Some("~/store/shell.js"),
        Path::new(HERE),
        Some(Path::new(HOME)),
        &fs,
    )
    .unwrap();
    assert_eq!(shell.root, PathBuf::from("/home/me/store"));
    assert_eq!(shell.module, PathBuf::from("shell.js"));
}

#[test]
fn a_slash_is_still_a_path_even_then() {
    // A handed-in module and a path really are two answers to one question,
    // and this is the case that refusal was written for. Both are named as
    // they were given: which instruction to keep is the question, and neither
    // of them is a place on disk yet.
    let fs = tree(&[
        ("/work/dist/shell.js", false),
        ("/store/page/shell.js", false),
    ]);
    assert_eq!(
        shell_module(
            "./dist/shell.js",
            Some("/store/page/shell.js"),
            Path::new(HERE),
            Some(Path::new(HOME)),
            &fs
        ),
        Err(ShellPathError::TwoPages {
            page: "/store/page/shell.js".to_string(),
            argument: "./dist/shell.js".to_string(),
        })
    );
}

#[test]
fn a_bare_name_with_no_module_behind_it_is_not_a_shell() {
    // The binary builds nothing, so a name on its own names nothing it could
    // serve. Refused as a path that is not there, which is what it is — and
    // named as it was typed, because it was never resolved: a name is not a
    // path and `/work/simple` is not what the user said.
    let fs = tree(&[]);
    assert_eq!(
        shell_module("simple", None, Path::new(HERE), Some(Path::new(HOME)), &fs),
        Err(ShellPathError::NotThere("simple".to_string()))
    );
}

#[test]
fn a_path_to_nothing_is_refused_before_anything_starts() {
    // A typo in the path is the ordinary failure, and it is worth catching
    // here rather than at the far end: what would otherwise find it is the
    // engine, a browser start later, as a window with nothing in it.
    let fs = tree(&[("/work/dist", true)]);
    assert_eq!(
        shell_module(
            "./dist/shell.js",
            None,
            Path::new(HERE),
            Some(Path::new(HOME)),
            &fs
        ),
        Err(ShellPathError::NotThere("/work/dist/shell.js".to_string()))
    );
}
