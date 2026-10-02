//! What `xdg-open` does inside a desktop: a link is `domicile open-url`, and
//! anything else is the `xdg-open` it stands in front of.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use domicile_launch::xdg_open::{link, underlying};

fn args(words: &[&str]) -> Vec<OsString> {
    words.iter().map(OsString::from).collect()
}

#[test]
fn a_web_address_is_a_link() {
    assert_eq!(
        link(&args(&["https://example.com/a?b"])),
        Some("https://example.com/a?b")
    );
    // Schemes are case-insensitive, and somebody's copy-paste is not lower
    // case.
    assert_eq!(
        link(&args(&["HTTP://example.com/"])),
        Some("HTTP://example.com/")
    );
}

#[test]
fn anything_else_is_not() {
    // A file, a mail address, a second argument: each is somebody else's
    // handler, and the real `xdg-open` knows which.
    assert_eq!(link(&args(&["notes.pdf"])), None);
    assert_eq!(link(&args(&["mailto:someone@example.com"])), None);
    assert_eq!(link(&args(&["file:///tmp/page.html"])), None);
    assert_eq!(
        link(&args(&["https://a.example", "https://b.example"])),
        None
    );
    assert_eq!(link(&args(&[])), None);
}

#[test]
fn the_underlying_one_is_the_next_on_the_path_that_is_not_this() {
    // THIS PROGRAM IS FIRST ON THE PATH, so the first `xdg-open` there is
    // itself. Handing a file to that would be a loop.
    let found = underlying(Some("/run/d/bin:/usr/local/bin:/usr/bin"), &|path| {
        path != Path::new("/run/d/bin/xdg-open") && path != Path::new("/usr/local/bin/xdg-open")
    });
    assert_eq!(found, Some(PathBuf::from("/usr/bin/xdg-open")));
}

#[test]
fn no_underlying_one_is_said_rather_than_guessed() {
    assert_eq!(underlying(Some("/run/d/bin"), &|_| false), None);
    assert_eq!(underlying(None, &|_| true), None);
}
