//! Where the index is kept, worked out from the environment.

use std::path::PathBuf;

use domicile_host::index_location::index_file;

/// What every answer here is, under whichever home was worked out.
const UNDER: &str = ".cache/domicile/file-index";

#[test]
fn it_lives_under_the_cache_home_when_one_is_set() {
    let path = index_file(&env(&[("XDG_CACHE_HOME", "/elsewhere/cache")]));

    assert_eq!(
        path,
        Some(PathBuf::from("/elsewhere/cache/domicile/file-index"))
    );
}

#[test]
fn a_home_with_no_cache_home_named_gets_the_specs_own_default() {
    let path = index_file(&env(&[("HOME", "/home/you")]));

    assert_eq!(path, Some(PathBuf::from("/home/you").join(UNDER)));
}

#[test]
fn a_relative_cache_home_is_ignored_rather_than_resolved() {
    // The spec's own rule rather than a kindness: a relative value resolves
    // against whatever directory the desktop happened to be started from, so
    // honoring one would put a desk's index somewhere that depends on where
    // its launcher was standing. The same reading `domicile_launch::config_path`
    // takes of `XDG_CONFIG_HOME`.
    let path = index_file(&env(&[("XDG_CACHE_HOME", "cache"), ("HOME", "/home/you")]));

    assert_eq!(path, Some(PathBuf::from("/home/you").join(UNDER)));
}

#[test]
fn nowhere_to_keep_it_is_an_answer_rather_than_a_guess() {
    // A desktop with no `HOME` has nothing to index either, so this is not a
    // case worth inventing a path for — and a cache written to a path nobody
    // named is a file nobody can find to delete.
    assert_eq!(index_file(&env(&[])), None);
}

/// The environment as a table, for a test that has no business reading the
/// real one.
fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    move |name| {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_string())
    }
}
