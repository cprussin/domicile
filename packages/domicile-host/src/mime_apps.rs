//! Which application opens a MIME type or URL scheme, per the XDG MIME
//! Applications spec: `mimeapps.list` defaults first, then entries that
//! declare the type in `MimeType`.
//!
//! The email portal opens `mailto:` URLs with this, and a press on a
//! notification starts its application with it. Read on each call, so a
//! changed default takes effect without a watch.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

/// The group keys are read from in a desktop entry.
const GROUP: &str = "[Desktop Entry]";

/// The spec's default for an unset or empty `XDG_CONFIG_DIRS`.
const DEFAULT_CONFIG_DIRS: &str = "/etc/xdg";

/// An application that opens a type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Handler {
    /// Its desktop file id.
    pub id: String,
    exec: String,
}

impl Handler {
    /// The argv that opens `url`, or `None` if its `Exec` is malformed.
    ///
    /// `url` takes the place of the first `%u` or `%U`; other field codes
    /// are dropped. Without either code, `url` goes last, as GIO does.
    pub fn command(&self, url: &str) -> Option<Vec<String>> {
        placed(&self.exec, url, URL_CODES)
    }

    /// The argv that opens the local file `path`, or `None` if its `Exec` is
    /// malformed.
    ///
    /// As [`Handler::command`], but `%f` and `%F` take `path` too: a local
    /// path is a URL to `%u` as well.
    pub fn file_command(&self, path: &str) -> Option<Vec<String>> {
        placed(&self.exec, path, FILE_CODES)
    }
}

/// The field codes a URL takes the place of.
const URL_CODES: &[char] = &['u', 'U'];

/// The field codes a local file takes the place of.
const FILE_CODES: &[char] = &['f', 'F', 'u', 'U'];

/// The `mimeapps.list` files, highest priority first.
///
/// `config_home` and `config_dirs` are `XDG_CONFIG_HOME` and
/// `XDG_CONFIG_DIRS`; empty means unset. `application_dirs` are
/// `applications/` under each of [`crate::data_dirs::data_dirs`]. Each directory offers
/// `<desktop>-mimeapps.list` before `mimeapps.list`.
pub fn lists(
    config_home: Option<OsString>,
    config_dirs: Option<OsString>,
    application_dirs: &[PathBuf],
    home: Option<&Path>,
    desktop: &str,
) -> Vec<PathBuf> {
    let config_home = config_home
        .filter(|set| !set.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".config")));
    let config_dirs = config_dirs
        .filter(|set| !set.is_empty())
        .unwrap_or_else(|| OsString::from(DEFAULT_CONFIG_DIRS));
    let ours = format!("{desktop}-mimeapps.list");
    config_home
        .into_iter()
        .chain(std::env::split_paths(&config_dirs))
        .chain(application_dirs.iter().cloned())
        .flat_map(|dir| [dir.join(&ours), dir.join("mimeapps.list")])
        .collect()
}

/// The application that opens a type, or `None` if none is installed.
///
/// `mimes` is the type, then its supertypes nearest first (see
/// [`crate::shared_mime_info::supertypes`]).
///
/// - Type by type, the first installed id under `[Default Applications]` in
///   `lists`. Unlike GIO, every type's defaults come before any type's
///   associations, so a user's `text/plain` default beats an app that only
///   declares `text/markdown`.
/// - Then type by type, as GIO does: each list's `[Added Associations]` ids,
///   highest priority first, then entries by id whose `MimeType` names it.
///   An id `[Removed Associations]` lists for the type, or for one before it,
///   is skipped, unless a list of higher priority added it.
///
/// Entries come from `application_dirs`. `Terminal` entries are skipped: the
/// desktop has no terminal to run them in. Unreadable lists are skipped, as
/// the spec says.
pub fn default_handler(
    mimes: &[&str],
    lists: &[PathBuf],
    application_dirs: &[PathBuf],
) -> Option<Handler> {
    let lists: Vec<String> = lists
        .iter()
        .filter_map(|list| fs::read_to_string(list).ok())
        .collect();
    let named = |group: &str, mime: &str| -> Vec<String> {
        lists
            .iter()
            .flat_map(|list| listed(list, group, mime))
            .collect()
    };
    let installed: Vec<Installed> = installed(application_dirs)
        .into_iter()
        .filter(|found| !found.terminal)
        .collect();
    let mut ids: Vec<String> = mimes
        .iter()
        .flat_map(|mime| named("[Default Applications]", mime))
        .collect();
    let mut removed = Vec::new();
    for mime in mimes {
        for list in &lists {
            let added = listed(list, "[Added Associations]", mime);
            ids.extend(added.into_iter().filter(|id| !removed.contains(id)));
            removed.extend(listed(list, "[Removed Associations]", mime));
        }
        ids.extend(
            installed
                .iter()
                .filter(|found| found.declares(mime) && !removed.contains(&found.handler.id))
                .map(|found| found.handler.id.clone()),
        );
    }
    ids.iter().find_map(|id| {
        installed
            .iter()
            .find(|found| found.handler.id == *id)
            .map(|found| found.handler.clone())
    })
}

/// The argv that starts the application whose desktop file id is `name` plus
/// `.desktop`, or `None` if none under `application_dirs` is usable.
///
/// A notification's `desktop-entry` hint names its application this way. Field
/// codes are dropped: it opens no file or URL.
pub fn launch_command(name: &str, application_dirs: &[PathBuf]) -> Option<Vec<String>> {
    let id = format!("{name}.desktop");
    installed(application_dirs)
        .into_iter()
        .find(|found| found.handler.id == id)
        .and_then(|found| expanded(&found.handler.exec, "", &[]).map(|(words, _)| words))
}

/// An installed handler and the types it declares.
struct Installed {
    handler: Handler,
    mime_types: String,
    terminal: bool,
}

impl Installed {
    fn declares(&self, mime: &str) -> bool {
        self.mime_types.split(';').any(|declared| declared == mime)
    }
}

/// Every usable application under `dirs`, sorted by id.
///
/// An id in an earlier directory hides the same id in later ones. Keeps
/// `NoDisplay` entries: they still open files.
fn installed(dirs: &[PathBuf]) -> Vec<Installed> {
    let mut found: Vec<(String, PathBuf)> = Vec::new();
    for (id, path) in dirs.iter().flat_map(|dir| entry_files(dir, dir)) {
        if !found.iter().any(|(seen, _)| *seen == id) {
            found.push((id, path));
        }
    }
    found.sort();
    found
        .into_iter()
        .filter_map(|(id, path)| {
            // The spec says to ignore unreadable files.
            let text = fs::read_to_string(path).ok()?;
            let keys = keys(&text);
            let exec = keys.get("Exec")?;
            let usable =
                keys.get("Type") == Some(&"Application") && keys.get("Hidden") != Some(&"true");
            usable.then(|| Installed {
                handler: Handler {
                    id,
                    exec: exec.to_string(),
                },
                mime_types: keys.get("MimeType").unwrap_or(&"").to_string(),
                terminal: keys.get("Terminal") == Some(&"true"),
            })
        })
        .collect()
}

/// The ids `list` gives `mime` under `group`, in order.
fn listed(list: &str, group: &str, mime: &str) -> Vec<String> {
    let mut current = "";
    list.lines()
        .map(str::trim)
        .filter_map(|line| {
            if line.starts_with('[') {
                current = line;
                None
            } else if current == group {
                line.split_once('=')
                    .filter(|(key, _)| key.trim() == mime)
                    .map(|(_, ids)| ids)
            } else {
                None
            }
        })
        .flat_map(|ids| ids.split(';'))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(String::from)
        .collect()
}

/// The unlocalized keys in `text`'s `[Desktop Entry]` group. The first of a
/// repeated key wins.
pub(crate) fn keys(text: &str) -> HashMap<&str, &str> {
    let mut group = "";
    let mut keys = HashMap::new();
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            group = line;
        } else if group == GROUP && !line.starts_with('#') {
            if let Some((key, value)) = line.split_once('=') {
                keys.entry(key.trim()).or_insert(value.trim());
            }
        }
    }
    keys
}

/// Every `.desktop` file under `dir`, with its id relative to `root`.
pub(crate) fn entry_files(root: &Path, dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(listed) = fs::read_dir(dir) else {
        return Vec::new();
    };
    listed
        .flatten()
        .flat_map(|found| {
            let path = found.path();
            if path.is_dir() {
                entry_files(root, &path)
            } else if path.extension().is_some_and(|ext| ext == "desktop") {
                let id = path
                    .strip_prefix(root)
                    .expect("a file under the directory it was listed in")
                    .to_string_lossy()
                    .replace('/', "-");
                vec![(id, path)]
            } else {
                Vec::new()
            }
        })
        .collect()
}

/// Argv for `exec` with `arg` in place of the first of `codes`, or after the
/// last word when there is none, as GIO does. Other field codes are dropped.
fn placed(exec: &str, arg: &str, codes: &[char]) -> Option<Vec<String>> {
    expanded(exec, arg, codes).map(|(mut words, placed)| {
        if !placed {
            words.push(arg.to_string());
        }
        words
    })
}

/// Argv for `exec` with `arg` in place of the first of `codes`, and whether it
/// was placed. `None` if `exec` is malformed or empty.
///
/// Unescapes strings, then quoting, in the spec's order.
fn expanded(exec: &str, arg: &str, codes: &[char]) -> Option<(Vec<String>, bool)> {
    let exec = unescaped(exec);
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut placed = false;
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', _) => quoted = !quoted,
            ('\\', true) => word.push(chars.next()?),
            ('%', _) => match chars.next()? {
                '%' => word.push('%'),
                code if codes.contains(&code) && !placed => {
                    word.push_str(arg);
                    placed = true;
                }
                _ => {}
            },
            (' ', false) => finish(&mut words, &mut word),
            _ => word.push(c),
        }
    }
    if quoted {
        return None;
    }
    finish(&mut words, &mut word);
    (!words.is_empty()).then_some((words, placed))
}

/// Ends the current word, dropping it if empty (a lone field code or repeated
/// spaces).
fn finish(words: &mut Vec<String>, word: &mut String) {
    if !word.is_empty() {
        words.push(std::mem::take(word));
    }
}

/// Resolves the desktop entry spec's string escapes.
pub(crate) fn unescaped(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next() {
                Some('s') => out.push(' '),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            },
            _ => out.push(c),
        }
    }
    out
}
