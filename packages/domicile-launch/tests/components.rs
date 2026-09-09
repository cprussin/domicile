//! A desktop is three programs shipped together, and two of them are found.

use std::path::{Path, PathBuf};

use domicile_launch::components::{components, Components};

fn nothing(_: &str) -> Option<String> {
    None
}

/// The layout a package installs, as a set of paths that exist.
const INSTALLED: &[&str] = &[
    "/usr/bin/domicile",
    "/usr/bin/domicile-compositor",
    "/usr/libexec/domicile/engine",
];

fn installed(path: &Path) -> bool {
    INSTALLED.iter().any(|there| Path::new(there) == path)
}

#[test]
fn the_two_are_found_beside_the_binary() {
    assert_eq!(
        components(Path::new("/usr/bin/domicile"), &nothing, &installed).unwrap(),
        Components {
            compositor: PathBuf::from("/usr/bin/domicile-compositor"),
            engine: PathBuf::from("/usr/libexec/domicile/engine"),
        }
    );
}

#[test]
fn a_store_path_finds_its_own_siblings() {
    // `current_exe` resolves `/proc/self/exe`, so a `~/.nix-profile/bin`
    // symlink arrives here already pointing into the store — which is where
    // the other three are, in the same output.
    let store = |path: &Path| {
        [
            "/nix/store/abc-domicile/bin/domicile-compositor",
            "/nix/store/abc-domicile/libexec/domicile/engine",
        ]
        .iter()
        .any(|there| Path::new(there) == path)
    };
    let found = components(
        Path::new("/nix/store/abc-domicile/bin/domicile"),
        &nothing,
        &store,
    )
    .unwrap();
    assert_eq!(
        found.compositor,
        PathBuf::from("/nix/store/abc-domicile/bin/domicile-compositor")
    );
}

#[test]
fn the_environment_overrides_one_without_the_others() {
    // A checkout points at what it just built, and the rest still come from
    // the package it is running out of.
    let env = |name: &str| {
        (name == "DOMICILE_COMPOSITOR").then(|| "/w/target/debug/domicile-compositor".to_string())
    };
    let found = components(Path::new("/usr/bin/domicile"), &env, &installed).unwrap();
    assert_eq!(
        found.compositor,
        PathBuf::from("/w/target/debug/domicile-compositor")
    );
    assert_eq!(found.engine, PathBuf::from("/usr/libexec/domicile/engine"));
}

#[test]
fn an_override_is_taken_without_asking_whether_it_is_there() {
    // Somebody who named a path meant it. Checking would refuse a component
    // that a build is about to produce, and the program that runs it reports
    // the failure with the reason attached.
    let env = |name: &str| (name == "DOMICILE_ENGINE").then(|| "/not/built/yet".to_string());
    let found = components(Path::new("/usr/bin/domicile"), &env, &installed).unwrap();
    assert_eq!(found.engine, PathBuf::from("/not/built/yet"));
}

#[test]
fn a_missing_sibling_names_what_is_missing_and_how_to_say_where_it_is() {
    // One of the three absent rather than all of them: with every path gone,
    // which one is reported is whichever the struct happens to fill first,
    // and a test that pinned that would be asserting field order.
    let no_compositor =
        |path: &Path| installed(path) && Path::new("/usr/bin/domicile-compositor") != path;
    let refused = components(Path::new("/usr/bin/domicile"), &nothing, &no_compositor)
        .expect_err("the compositor is not beside it");

    assert_eq!(refused.what, "compositor");
    assert_eq!(refused.variable, "DOMICILE_COMPOSITOR");
    assert_eq!(
        refused.looked,
        PathBuf::from("/usr/bin/domicile-compositor")
    );
    // The message has to carry the path, because "no compositor" sends a
    // reader looking in the place they assumed rather than the one asked for.
    assert!(
        refused.to_string().contains("/usr/bin/domicile-compositor"),
        "{refused}"
    );
}
