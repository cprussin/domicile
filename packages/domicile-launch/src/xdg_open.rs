//! What `xdg-open` does inside a desktop.
//!
//! The desktop puts `domicile-xdg-open` first on every app's `PATH` under the
//! name `xdg-open` (see [`crate::spawn`]). A link — one web address — goes to
//! `domicile open-url`, so it opens in a browser window of this desktop
//! whatever `mimeapps.list` says. Anything else is handed to the `xdg-open`
//! this one stands in front of, which knows which program opens a PDF.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The link `args` is, if it is one: exactly one argument, an `http:` or
/// `https:` URL.
///
/// Only the web. `mailto:` is a mail client's and `file:` is whatever opens
/// that file; neither is a browser window's to answer.
pub fn link(args: &[OsString]) -> Option<&str> {
    match args {
        [only] => only.to_str().filter(|word| {
            word.split_once(':').is_some_and(|(scheme, _)| {
                scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
            })
        }),
        _ => None,
    }
}

/// The `xdg-open` this one stands in front of: the first on `path` that
/// `usable` accepts.
///
/// `usable` is asked about each `<dir>/xdg-open` in order, and is what says
/// both that it exists and that it is not this program — which is first on
/// the path, so the first answer would otherwise be a loop.
pub fn underlying(path: Option<&str>, usable: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    path?
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join("xdg-open"))
        .find(|candidate| usable(candidate))
}
