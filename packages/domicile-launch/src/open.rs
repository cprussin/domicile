//! What `domicile open` does with a file, folder or address.
//!
//! A web address opens in a browser window of the desktop, whatever
//! `mimeapps.list` says. Anything else runs the application its type's
//! default names: the type's own default, then its supertypes' (see
//! `domicile_host::shared_mime_info`), then an entry that declares one of
//! them. See `domicile_host::mime_apps::default_handler`.

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt as _;
use std::path::{Path, PathBuf};

use domicile_host::mime_apps::{default_handler, Handler};
use domicile_host::shared_mime_info::{aliases, content_type, supertypes};

use crate::address::{has_scheme, url_for};

/// The desktop whose own `<desktop>-mimeapps.list` is read first. Matches the
/// compositor's `XDG_CURRENT_DESKTOP`.
pub const DESKTOP: &str = "domicile";

/// Where the desk's types and defaults are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Places {
    /// The XDG data directories, highest priority first. Types come from
    /// their `mime/` and applications from their `applications/`.
    pub data_dirs: Vec<PathBuf>,
    /// The `mimeapps.list` files, highest priority first; see
    /// `domicile_host::mime_apps::lists`.
    pub lists: Vec<PathBuf>,
}

/// What opening a target does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Opening {
    /// Open this web address in a browser window of the desktop.
    Browse(String),
    /// Run this argv in the caller's place.
    Run(Vec<String>),
}

/// Why a target cannot be opened.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OpenError {
    #[error("cannot open {path}: {why}")]
    Unreadable { path: String, why: String },
    #[error(
        "no installed application opens {target} ({mime}). Name one in \
         ~/.config/mimeapps.list:\n\n    \
         [Default Applications]\n    \
         {mime}=<application>.desktop\n"
    )]
    NoApplication { target: String, mime: String },
    #[error("{id}, which opens {target}, has an Exec line that cannot be read")]
    UnreadableExec { id: String, target: String },
    #[error(
        "{id}, which opens {target}, runs {program}, which would ask domicile \
         to open it again"
    )]
    Loop {
        id: String,
        target: String,
        program: String,
    },
    #[error("cannot find the app module {target}: {why}")]
    NoModule { target: String, why: String },
}

/// What `domicile open --app` does with a target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppOpening {
    /// Run the app module at this path in an app window.
    Module(String),
    /// Open this address in an app window.
    Address(String),
}

/// What opening `target`, relative to `here`, as an app does.
///
/// - An address opens in an app window.
/// - An existing file runs as an app module, unless it is a web page
///   (`.html`, `.htm`), which opens in an app window as other addresses do.
///   So does a folder.
/// - A missing file is an error, not an app window that shows nothing.
pub fn app_opening(target: &str, here: &Path) -> Result<AppOpening, OpenError> {
    if has_scheme(target) {
        return Ok(AppOpening::Address(target.to_string()));
    }
    let path = here.join(target);
    let found = std::fs::metadata(&path).map_err(|why| OpenError::NoModule {
        target: target.to_string(),
        why: why.to_string(),
    })?;
    let page = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("html") || ext.eq_ignore_ascii_case("htm"));
    if found.is_file() && !page {
        Ok(AppOpening::Module(target.to_string()))
    } else {
        Ok(AppOpening::Address(url_for(target, here)))
    }
}

/// What opening `target`, relative to `here`, does on the desk at `places`.
///
/// - `http:` and `https:` addresses browse.
/// - A `file:` address, or a path that is no address, opens as a file.
/// - Any other address opens with its scheme's handler,
///   `x-scheme-handler/<scheme>`.
pub fn opening(target: &str, here: &Path, places: &Places) -> Result<Opening, OpenError> {
    let scheme = has_scheme(target)
        .then(|| target.split_once(':'))
        .flatten()
        .map(|(scheme, _)| scheme.to_ascii_lowercase());
    match scheme.as_deref() {
        Some("http" | "https") => Ok(Opening::Browse(target.to_string())),
        Some("file") => file_opening(target, &here.join(file_path(target)), places),
        Some(scheme) => {
            let mime = format!("x-scheme-handler/{scheme}");
            let handler = handler(target, &[&mime], places)?;
            run(target, &handler, handler.command(target))
        }
        None => file_opening(target, &here.join(target), places),
    }
}

/// Opening the file or folder at `path`, which the user named `target`.
fn file_opening(target: &str, path: &Path, places: &Places) -> Result<Opening, OpenError> {
    let mime = content_type(path, &places.data_dirs).map_err(|why| OpenError::Unreadable {
        path: target.to_string(),
        why: why.to_string(),
    })?;
    let unreadable = |why: std::io::Error| OpenError::Unreadable {
        path: target.to_string(),
        why: why.to_string(),
    };
    // Each type, then the other names it goes by, which `mimeapps.list` may
    // use instead.
    let mut mimes = Vec::new();
    for mime in std::iter::once(mime.clone())
        .chain(supertypes(&mime, &places.data_dirs).map_err(unreadable)?)
    {
        let other_names = aliases(&mime, &places.data_dirs).map_err(unreadable)?;
        mimes.push(mime);
        mimes.extend(other_names);
    }
    let mimes: Vec<&str> = mimes.iter().map(String::as_str).collect();
    let handler = handler(target, &mimes, places)?;
    run(
        target,
        &handler,
        handler.file_command(&path.to_string_lossy()),
    )
}

/// Running `command`, `handler`'s for `target`, unless it is unreadable or
/// would hand `target` back to `domicile open`.
fn run(
    target: &str,
    handler: &Handler,
    command: Option<Vec<String>>,
) -> Result<Opening, OpenError> {
    let argv = command.ok_or_else(|| OpenError::UnreadableExec {
        id: handler.id.clone(),
        target: target.to_string(),
    })?;
    let program = Path::new(&argv[0])
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let again = matches!(program.as_str(), "xdg-open" | "domicile-xdg-open")
        // `open --app` opens an app window, not the type's default.
        || (program == "domicile"
            && argv.get(1).is_some_and(|verb| verb == "open")
            && argv.get(2).is_none_or(|flag| flag != "--app"));
    match again {
        true => Err(OpenError::Loop {
            id: handler.id.clone(),
            target: target.to_string(),
            program,
        }),
        false => Ok(Opening::Run(argv)),
    }
}

/// The application for `mimes`, the first of which is `target`'s type.
fn handler(
    target: &str,
    mimes: &[&str],
    places: &Places,
) -> Result<domicile_host::mime_apps::Handler, OpenError> {
    let applications: Vec<PathBuf> = places
        .data_dirs
        .iter()
        .map(|dir| dir.join("applications"))
        .collect();
    default_handler(mimes, &places.lists, &applications).ok_or_else(|| OpenError::NoApplication {
        target: target.to_string(),
        mime: mimes[0].to_string(),
    })
}

/// The path a `file:` address names, percent-decoded. A host, query and
/// fragment are dropped: only this machine's files can be opened. A relative
/// path stays relative.
fn file_path(url: &str) -> PathBuf {
    let rest = &url["file:".len()..];
    let rest = rest.find(['?', '#']).map_or(rest, |at| &rest[..at]);
    let path = match rest.strip_prefix("//") {
        Some(authority) => authority.find('/').map_or("/", |at| &authority[at..]),
        None => rest,
    };
    PathBuf::from(OsString::from_vec(decoded(path)))
}

/// `text`'s bytes with each `%XX` replaced by its byte. A `%` not followed by
/// two hex digits stays as it is.
fn decoded(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let hex = bytes
            .get(at + 1..at + 3)
            .filter(|pair| pair.iter().all(u8::is_ascii_hexdigit))
            .and_then(|pair| std::str::from_utf8(pair).ok())
            .and_then(|pair| u8::from_str_radix(pair, 16).ok());
        match (bytes[at], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                at += 3;
            }
            (byte, _) => {
                out.push(byte);
                at += 1;
            }
        }
    }
    out
}
