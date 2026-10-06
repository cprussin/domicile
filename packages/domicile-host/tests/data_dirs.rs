//! Where the XDG data directories are.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use domicile_host::data_dirs::data_dirs;

#[test]
fn the_data_home_comes_before_the_data_dirs() {
    assert_eq!(
        data_dirs(
            Some(OsString::from("/data/home")),
            Some(OsString::from("/a/share:/b/share")),
            Some(Path::new("/home/you")),
        ),
        vec![
            PathBuf::from("/data/home"),
            PathBuf::from("/a/share"),
            PathBuf::from("/b/share"),
        ]
    );
}

#[test]
fn with_no_home_and_no_data_home_there_is_no_data_home() {
    assert_eq!(
        data_dirs(None, Some(OsString::from("/a/share")), None),
        vec![PathBuf::from("/a/share")]
    );
}

#[test]
fn unset_or_empty_variables_are_the_specs_defaults() {
    let expected = vec![
        PathBuf::from("/home/you/.local/share"),
        PathBuf::from("/usr/local/share"),
        PathBuf::from("/usr/share"),
    ];
    assert_eq!(
        data_dirs(None, None, Some(Path::new("/home/you"))),
        expected
    );
    assert_eq!(
        data_dirs(
            Some(OsString::new()),
            Some(OsString::new()),
            Some(Path::new("/home/you"))
        ),
        expected
    );
}
