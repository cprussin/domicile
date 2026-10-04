//! The `xdg-open` replacement apps see inside a desktop.
//!
//! `domicile-xdg-open` is first on every app's `PATH` as `xdg-open` (see
//! [`crate::spawn`]). A single web URL goes to `domicile open-url`, so it
//! opens in this desktop regardless of `mimeapps.list`. Anything else goes to
//! the system `xdg-open`.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Returns the URL if `args` is a single `http:` or `https:` URL.
///
/// Other schemes such as `mailto:` and `file:` belong to other programs.
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

/// Returns the first `<dir>/xdg-open` on `path` that `usable` accepts.
///
/// `usable` must reject this program, which is first on the path, or the call
/// would loop.
pub fn underlying(path: Option<&str>, usable: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    path?
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join("xdg-open"))
        .find(|candidate| usable(candidate))
}
