//! Reads desktop entries for the launcher's application results.
//!
//! Entries are read on every search rather than indexed. There are only
//! hundreds, so a read takes milliseconds, and newly installed applications
//! appear without a watch. Entries live in `applications/` under
//! `$XDG_DATA_HOME`, then each of `$XDG_DATA_DIRS`.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use domicile_protocol::DesktopEntry;

/// The only group the launcher reads keys from.
const GROUP: &str = "[Desktop Entry]";

/// The spec's default for an unset or empty `XDG_DATA_DIRS`.
const DEFAULT_DATA_DIRS: &str = "/usr/local/share:/usr/share";

/// A launchable application and the text a query matches against.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// The entry sent to the launcher.
    pub entry: DesktopEntry,
    /// `Name`, `GenericName` and `Keywords`, in lower case.
    words: String,
    /// `Icon`: a theme name or an absolute path.
    icon_name: Option<String>,
    /// `X-Domicile-Preview`, in the same form as `Icon`.
    preview_name: Option<String>,
}

impl Entry {
    /// The icon name, for `crate::app_icons` to resolve.
    pub fn icon_name(&self) -> Option<&str> {
        self.icon_name.as_deref()
    }

    /// The preview image name, for `crate::app_icons` to resolve.
    pub fn preview_name(&self) -> Option<&str> {
        self.preview_name.as_deref()
    }
}

/// `applications/` under each of [`data_dirs`], highest priority first.
pub fn application_dirs(
    data_home: Option<OsString>,
    data_dirs: Option<OsString>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    self::data_dirs(data_home, data_dirs, home)
        .into_iter()
        .map(|dir| dir.join("applications"))
        .collect()
}

/// The XDG data directories, highest priority first.
///
/// `data_home` and `data_dirs` are `XDG_DATA_HOME` and `XDG_DATA_DIRS`. Per
/// the spec, empty means unset. Without either `data_home` or `home`, the data
/// home is omitted.
pub fn data_dirs(
    data_home: Option<OsString>,
    data_dirs: Option<OsString>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let data_home = data_home
        .filter(|set| !set.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".local/share")));
    let data_dirs = data_dirs
        .filter(|set| !set.is_empty())
        .unwrap_or_else(|| OsString::from(DEFAULT_DATA_DIRS));
    data_home
        .into_iter()
        .chain(std::env::split_paths(&data_dirs))
        .collect()
}

/// Every application under `dirs`, unordered.
///
/// An ID in an earlier directory hides the same ID in later ones, even when
/// the earlier entry is `Hidden`. That is how a user removes a system entry.
/// Missing directories are skipped.
pub fn installed(dirs: &[PathBuf]) -> Vec<Entry> {
    let mut seen = HashSet::new();
    dirs.iter()
        .flat_map(|dir| entry_files(dir, dir))
        .filter(|(id, _)| seen.insert(id.clone()))
        .filter_map(|(id, path)| {
            // The spec says to ignore unreadable files.
            let text = fs::read_to_string(path).ok()?;
            parse(&id, &text)
        })
        .collect()
}

/// Parses entry `text` as `id`, or `None` if the launcher should not show it.
///
/// Reads only unlocalized keys in `[Desktop Entry]`. Rejects non-applications,
/// `Hidden` or `NoDisplay` entries, and entries missing `Name` or `Exec`. Also
/// rejects `Terminal` entries, since there is no configured terminal.
pub fn parse(id: &str, text: &str) -> Option<Entry> {
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
    let flag = |key: &str| keys.get(key) == Some(&"true");
    if keys.get("Type") != Some(&"Application")
        || flag("Hidden")
        || flag("NoDisplay")
        || flag("Terminal")
    {
        return None;
    }
    let name = unescaped(keys.get("Name")?);
    let command = command(keys.get("Exec")?)?;
    let words = [
        name.as_str(),
        &unescaped(keys.get("GenericName").unwrap_or(&"")),
        &unescaped(keys.get("Keywords").unwrap_or(&"")),
    ]
    .join("\n")
    .to_lowercase();
    Some(Entry {
        entry: DesktopEntry {
            id: id.to_string(),
            name,
            comment: unescaped(keys.get("Comment").unwrap_or(&"")),
            command,
            // Resolved later, only for entries a search returns.
            icon: None,
            preview: None,
        },
        words,
        icon_name: keys.get("Icon").map(|icon| unescaped(icon)),
        preview_name: keys
            .get("X-Domicile-Preview")
            .map(|preview| unescaped(preview)),
    })
}

/// Parses an `Exec` value into argv, or `None` if it is malformed.
///
/// Unescapes strings, then quoting, in the spec's order. Drops field codes,
/// since the launcher passes no files, URLs or icon, along with any argument
/// that was only a field code.
pub fn command(exec: &str) -> Option<Vec<String>> {
    let exec = unescaped(exec);
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', _) => quoted = !quoted,
            ('\\', true) => word.push(chars.next()?),
            ('%', _) => {
                if chars.next()? == '%' {
                    word.push('%');
                }
            }
            (' ', false) => finish(&mut words, &mut word),
            _ => word.push(c),
        }
    }
    if quoted {
        return None;
    }
    finish(&mut words, &mut word);
    (!words.is_empty()).then_some(words)
}

/// Up to `limit` applications matching `query`, best first.
///
/// Every query word must appear, case-insensitively, in the name, generic name
/// or keywords, matching the file search's rule. Names that start with the
/// query rank first, then sort by name.
pub fn find<'a>(entries: &'a [Entry], query: &str, limit: usize) -> Vec<&'a Entry> {
    let query = query.trim().to_lowercase();
    let words: Vec<&str> = query.split_whitespace().collect();
    let mut matched: Vec<(bool, String, &Entry)> = entries
        .iter()
        .filter(|entry| words.iter().all(|word| entry.words.contains(word)))
        .map(|entry| {
            let name = entry.entry.name.to_lowercase();
            (!name.starts_with(&query), name, entry)
        })
        .collect();
    // Break name ties by ID so the order does not depend on directory listing.
    matched.sort_by(|a, b| (a.0, &a.1, &a.2.entry.id).cmp(&(b.0, &b.1, &b.2.entry.id)));
    matched
        .into_iter()
        .take(limit)
        .map(|(_, _, entry)| entry)
        .collect()
}

/// Every `.desktop` file under `dir`, with its ID relative to `root`.
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
