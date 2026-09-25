//! Where the engine keeps its profile between desktops.

use std::path::PathBuf;

use domicile_launch::profile_path::profile_directory;

/// The environment as a pair of variables, which is all this reads.
fn env(xdg: Option<&'static str>, home: Option<&'static str>) -> impl Fn(&str) -> Option<String> {
    move |name| match name {
        "XDG_STATE_HOME" => xdg.map(str::to_string),
        "HOME" => home.map(str::to_string),
        _ => None,
    }
}

#[test]
fn the_profile_is_under_the_state_home() {
    assert_eq!(
        profile_directory(&env(Some("/elsewhere"), Some("/home/somebody"))),
        Some(PathBuf::from("/elsewhere/domicile/profile"))
    );
}

#[test]
fn without_a_state_home_it_is_where_the_spec_says_one_is() {
    assert_eq!(
        profile_directory(&env(None, Some("/home/somebody"))),
        Some(PathBuf::from(
            "/home/somebody/.local/state/domicile/profile"
        ))
    );
}

#[test]
fn a_state_home_that_is_not_a_path_is_not_one() {
    // The spec's rule, as for the config home: an empty or relative value is
    // treated as unset, because a relative one resolves against wherever the
    // desktop happened to be started from.
    for nonsense in ["", "state", "./state"] {
        assert_eq!(
            profile_directory(&env(Some(nonsense), Some("/home/somebody"))),
            Some(PathBuf::from(
                "/home/somebody/.local/state/domicile/profile"
            )),
            "XDG_STATE_HOME={nonsense:?}"
        );
    }
}

#[test]
fn with_no_home_there_is_nowhere_to_keep_one() {
    assert_eq!(profile_directory(&env(None, None)), None);
    assert_eq!(profile_directory(&env(None, Some("home"))), None);
}
