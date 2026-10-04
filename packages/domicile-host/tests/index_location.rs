//! Tests for the file index path derived from the environment.

use std::path::PathBuf;

use domicile_host::index_location::index_file;

/// The index path relative to `HOME`.
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
    // The XDG spec says to ignore relative paths, which would depend on the
    // working directory. `domicile_launch::config_path` treats
    // `XDG_CONFIG_HOME` the same way.
    let path = index_file(&env(&[("XDG_CACHE_HOME", "cache"), ("HOME", "/home/you")]));

    assert_eq!(path, Some(PathBuf::from("/home/you").join(UNDER)));
}

#[test]
fn nowhere_to_keep_it_is_an_answer_rather_than_a_guess() {
    // With no `HOME` there is nothing to index, and a cache at an invented
    // path would be hard to find and delete.
    assert_eq!(index_file(&env(&[])), None);
}

/// A fake environment, so tests do not read the real one.
fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    move |name| {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_string())
    }
}
