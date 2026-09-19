//! Where the compositor's config comes from when nobody named one.

use std::path::{Path, PathBuf};

use domicile_launch::config_path::{config_file, ConfigFile};

/// The environment as a pair of variables, which is all this reads.
fn env(xdg: Option<&'static str>, home: Option<&'static str>) -> impl Fn(&str) -> Option<String> {
    move |name| match name {
        "XDG_CONFIG_HOME" => xdg.map(str::to_string),
        "HOME" => home.map(str::to_string),
        _ => None,
    }
}

/// A tiny filesystem: the paths that exist, and nothing else does.
fn tree(entries: &'static [&'static str]) -> impl Fn(&Path) -> bool {
    move |path| entries.iter().any(|there| Path::new(there) == path)
}

fn nothing(_: &Path) -> bool {
    false
}

const DEFAULT: &str = "/home/somebody/.config/domicile/domicile.toml";

#[test]
fn the_flag_wins_and_is_not_looked_for() {
    // Handed on unexamined, the way it always was: what is in it is the
    // compositor's business, and this process opening it first would be a
    // second reader to disagree with. A path that does not exist is still the
    // path they asked for, and the compositor's complaint about it is the one
    // that names the file it could not read.
    assert_eq!(
        config_file(
            Some(Path::new("/tmp/desk.toml")),
            &env(None, Some("/home/somebody")),
            &tree(&[DEFAULT])
        ),
        ConfigFile::Named(PathBuf::from("/tmp/desk.toml"))
    );
}

#[test]
fn the_default_is_under_the_config_home() {
    assert_eq!(
        config_file(None, &env(None, Some("/home/somebody")), &tree(&[DEFAULT])),
        ConfigFile::Found(PathBuf::from(DEFAULT))
    );
}

#[test]
fn xdg_config_home_is_preferred_over_the_guess_at_it() {
    assert_eq!(
        config_file(
            None,
            &env(Some("/elsewhere"), Some("/home/somebody")),
            &tree(&["/elsewhere/domicile/domicile.toml", DEFAULT])
        ),
        ConfigFile::Found(PathBuf::from("/elsewhere/domicile/domicile.toml"))
    );
}

#[test]
fn a_config_home_that_is_not_a_path_is_not_one() {
    // The spec says so outright: `XDG_CONFIG_HOME` is used when it is set to
    // an absolute path, and treated as unset otherwise. Both ways it can fail
    // are here, and both are a variable somebody exported by hand -- a
    // relative path resolves against whatever directory the desktop happened
    // to be started from, and the empty string is what an unset variable
    // looks like to a shell that exported it anyway.
    for nonsense in ["", "config", "./config"] {
        assert_eq!(
            config_file(
                None,
                &env(Some(nonsense), Some("/home/somebody")),
                &tree(&[DEFAULT])
            ),
            ConfigFile::Found(PathBuf::from(DEFAULT)),
            "XDG_CONFIG_HOME={nonsense:?}"
        );
    }
}

#[test]
fn no_file_there_is_the_defaults_and_says_where_it_looked() {
    // NOT AN ERROR, and the path is carried anyway. A desktop with no monitors
    // written down is a desktop -- that is what made the flag optional in the
    // first place -- but "the compositor's defaults" on its own is the same
    // sentence whether the file is missing, misspelled or in the other config
    // directory, so it names the one place that was looked.
    assert_eq!(
        config_file(None, &env(None, Some("/home/somebody")), &nothing),
        ConfigFile::Absent(PathBuf::from(DEFAULT))
    );
}

#[test]
fn a_run_with_no_home_at_all_has_nowhere_to_look() {
    // There is no fallback for this and there should not be: a config home
    // guessed without a home directory would be somebody else's. A daemon or
    // a container starts like this, and it is a run of the defaults rather
    // than a run to refuse.
    assert_eq!(
        config_file(None, &env(None, None), &tree(&[DEFAULT])),
        ConfigFile::Nowhere
    );
    assert_eq!(
        config_file(None, &env(Some(""), Some("")), &tree(&[DEFAULT])),
        ConfigFile::Nowhere
    );
}

#[test]
fn what_each_answer_is_run_with() {
    // The whole point of the enum: three of the four hand the compositor a
    // path and one hands it nothing. A `--config` that got dropped on the way
    // through here would be a desk coming up unplaced with its own config file
    // sitting right there.
    assert_eq!(
        ConfigFile::Named(PathBuf::from("/tmp/desk.toml")).path(),
        Some(Path::new("/tmp/desk.toml"))
    );
    assert_eq!(
        ConfigFile::Found(PathBuf::from(DEFAULT)).path(),
        Some(Path::new(DEFAULT))
    );
    assert_eq!(ConfigFile::Absent(PathBuf::from(DEFAULT)).path(), None);
    assert_eq!(ConfigFile::Nowhere.path(), None);
}

#[test]
fn every_answer_says_which_one_it_is() {
    // Printed by the binary before anything starts, because a desk in the
    // wrong arrangement is most often this file being a different one than the
    // person thinks -- and now that one of the four is a file nobody typed,
    // "config: <path>" alone no longer says which.
    assert_eq!(
        ConfigFile::Named(PathBuf::from("/tmp/desk.toml")).to_string(),
        "/tmp/desk.toml, because --config names it"
    );
    assert_eq!(
        ConfigFile::Found(PathBuf::from(DEFAULT)).to_string(),
        format!("{DEFAULT}, found where a config lives")
    );
    assert_eq!(
        ConfigFile::Absent(PathBuf::from(DEFAULT)).to_string(),
        format!("none -- no {DEFAULT} -- so the compositor's defaults")
    );
    assert_eq!(
        ConfigFile::Nowhere.to_string(),
        "none -- neither XDG_CONFIG_HOME nor HOME is set, so there is nowhere \
         to look -- so the compositor's defaults"
    );
}
