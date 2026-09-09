//! A shell is named or it is a path, and which one it is has rules.

use std::path::{Path, PathBuf};

use domicile_launch::shell_path::{shell_page, ShellPathError};

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
fn a_path_to_a_module_serves_the_directory_holding_it() {
    let fs = tree(&[("/d/dist", true), ("/d/dist/shell.js", false)]);
    assert_eq!(
        shell_page("/d/dist/shell.js", None, &fs).unwrap(),
        PathBuf::from("/d/dist")
    );
}

#[test]
fn a_path_to_a_directory_serves_it() {
    let fs = tree(&[("./dist", true), ("./dist/shell.js", false)]);
    assert_eq!(
        shell_page("./dist", None, &fs).unwrap(),
        PathBuf::from("./dist")
    );
}

#[test]
fn a_bare_name_that_is_also_a_directory_is_a_path() {
    // `domicile dist` from inside a shell's source tree. A directory here is
    // what somebody meant.
    let fs = tree(&[("dist", true), ("dist/shell.js", false)]);
    assert_eq!(
        shell_page("dist", None, &fs).unwrap(),
        PathBuf::from("dist")
    );
}

#[test]
fn a_handed_in_page_makes_a_bare_name_a_name() {
    // A packaged desktop sets the page it built and passes its own name along
    // for the log. Run from a directory that happens to contain a `simple/`,
    // that word must not become a path — the user's own `cd` is not an
    // argument.
    let fs = tree(&[
        ("simple", true),
        ("/store/page", true),
        ("/store/page/shell.js", false),
    ]);
    assert_eq!(
        shell_page("simple", Some("/store/page"), &fs).unwrap(),
        PathBuf::from("/store/page")
    );
}

#[test]
fn a_slash_is_still_a_path_even_then() {
    // A handed-in page and a path really are two answers to one question, and
    // this is the case that refusal was written for.
    let fs = tree(&[
        ("./dist", true),
        ("./dist/shell.js", false),
        ("/store/page", true),
    ]);
    assert_eq!(
        shell_page("./dist", Some("/store/page"), &fs),
        Err(ShellPathError::TwoPages {
            page: "/store/page".to_string(),
            argument: "./dist".to_string(),
        })
    );
}

#[test]
fn a_bare_name_with_no_page_behind_it_is_not_a_shell() {
    // The binary builds nothing, so a name on its own names nothing it could
    // serve. Refused as a path that is not there, which is what it is.
    let fs = tree(&[]);
    assert_eq!(
        shell_page("simple", None, &fs),
        Err(ShellPathError::NotThere("simple".to_string()))
    );
}

#[test]
fn a_directory_with_no_module_in_it_is_refused() {
    let fs = tree(&[("./dist", true)]);
    assert_eq!(
        shell_page("./dist", None, &fs),
        Err(ShellPathError::NoModule(PathBuf::from("./dist")))
    );
}
