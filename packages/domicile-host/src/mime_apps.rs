//! Which application opens a MIME type or URL scheme, per the XDG MIME
//! Applications spec: `mimeapps.list` defaults first, then entries that
//! declare the type in `MimeType`.
//!
//! The email portal opens `mailto:` URLs with this. Read on each call, so a
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
    /// `url` takes the place of `%u` or `%U`; other field codes are dropped.
    /// Without either code, `url` goes last, as GIO does.
    pub fn command(&self, url: &str) -> Option<Vec<String>> {
        expanded(&self.exec, url).map(|(mut words, placed)| {
            if !placed {
                words.push(url.to_string());
            }
            words
        })
    }
}

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

/// The application that opens `mime`, or `None` if none is installed.
///
/// The first installed id under `[Default Applications]` in `lists`, then
/// under `[Added Associations]`, then the first entry by id whose `MimeType`
/// names `mime` and no list removes. Entries come from `application_dirs`.
/// Unreadable lists are skipped, as the spec says.
pub fn default_handler(
    mime: &str,
    lists: &[PathBuf],
    application_dirs: &[PathBuf],
) -> Option<Handler> {
    let lists: Vec<String> = lists
        .iter()
        .filter_map(|list| fs::read_to_string(list).ok())
        .collect();
    let named = |group: &str| -> Vec<String> {
        lists
            .iter()
            .flat_map(|list| listed(list, group, mime))
            .collect()
    };
    let installed = installed(application_dirs);
    let removed = named("[Removed Associations]");
    let declaring = installed
        .iter()
        .filter(|handler| handler.declares(mime) && !removed.contains(&handler.handler.id))
        .map(|handler| handler.handler.id.clone());
    named("[Default Applications]")
        .into_iter()
        .chain(named("[Added Associations]"))
        .chain(declaring)
        .find_map(|id| {
            installed
                .iter()
                .find(|handler| handler.handler.id == id)
                .map(|handler| handler.handler.clone())
        })
}

/// An installed handler and the types it declares.
struct Installed {
    handler: Handler,
    mime_types: String,
}

impl Installed {
    fn declares(&self, mime: &str) -> bool {
        self.mime_types.split(';').any(|declared| declared == mime)
    }
}

/// Every usable application under `dirs`, sorted by id.
///
/// An id in an earlier directory hides the same id in later ones. Keeps
/// `NoDisplay` and `Terminal` entries: they still open files.
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
fn keys(text: &str) -> HashMap<&str, &str> {
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
fn entry_files(root: &Path, dir: &Path) -> Vec<(String, PathBuf)> {
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

/// Argv for `exec` with `url` in place of `%u` and `%U`, and whether it was
/// placed. `None` if `exec` is malformed or empty.
///
/// Unescapes strings, then quoting, in the spec's order.
fn expanded(exec: &str, url: &str) -> Option<(Vec<String>, bool)> {
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
                'u' | 'U' => {
                    word.push_str(url);
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
fn unescaped(value: &str) -> String {
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
