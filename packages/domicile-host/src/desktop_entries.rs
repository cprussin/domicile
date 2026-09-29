//! The applications a launcher offers, read from the machine's desktop entries.
//!
//! **Read on every search, not indexed.** A machine has hundreds of entries
//! rather than a home's hundreds of thousands of paths, so reading them is
//! milliseconds — and an application installed a moment ago is offered on the
//! next keystroke, with no watch to keep.
//!
//! Where they are is the XDG base directory spec's to say: `applications/`
//! under `$XDG_DATA_HOME`, then under each of `$XDG_DATA_DIRS`. What an entry
//! means is the desktop entry spec's, as much of it as a launcher needs.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use domicile_protocol::DesktopEntry;

/// The group every key a launcher reads is in.
const GROUP: &str = "[Desktop Entry]";

/// What `XDG_DATA_DIRS` means when it is unset or empty.
const DEFAULT_DATA_DIRS: &str = "/usr/local/share:/usr/share";

/// An application an entry offers, and what a query is matched against.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// What a launcher is sent.
    pub entry: DesktopEntry,
    /// `Name`, `GenericName` and `Keywords`, in lower case.
    words: String,
    /// `Icon`, as the entry names it: a theme name, or an absolute path.
    icon_name: Option<String>,
}

impl Entry {
    /// The icon this entry names, for `crate::app_icons` to find.
    pub fn icon_name(&self) -> Option<&str> {
        self.icon_name.as_deref()
    }
}

/// The directories entries are read from, the one that wins first: `data_dirs`
/// with `applications/` under each.
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

/// The XDG data directories, the one that wins first.
///
/// `data_home` and `data_dirs` are `XDG_DATA_HOME` and `XDG_DATA_DIRS`; unset
/// and empty are the same thing, which is the spec's rule. With neither a data
/// home nor a home to default it under, there is no data home to read.
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

/// Every application the entries under `dirs` offer, in no order.
///
/// An ID found in an earlier directory hides the same ID in a later one —
/// including when the earlier one is `Hidden`, which is how a user removes a
/// system entry from their menu. A directory that does not exist is an
/// ordinary one to list in `XDG_DATA_DIRS`, and offers nothing.
pub fn installed(dirs: &[PathBuf]) -> Vec<Entry> {
    let mut seen = HashSet::new();
    dirs.iter()
        .flat_map(|dir| entry_files(dir, dir))
        .filter(|(id, _)| seen.insert(id.clone()))
        .filter_map(|(id, path)| {
            // Unreadable or not UTF-8 is ignored, as the desktop entry spec
            // has a launcher do with any file it cannot read.
            let text = fs::read_to_string(path).ok()?;
            parse(&id, &text)
        })
        .collect()
}

/// The application `text` offers under `id`, if it is one a launcher shows.
///
/// Only the `[Desktop Entry]` group, and only unlocalized keys. Not an
/// application — a link, a directory, one that is `Hidden` or `NoDisplay`, one
/// with no `Name` or no command — is nothing. So is one that runs in a
/// terminal: which terminal is not something this desktop knows.
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
            // Found and drawn later, and only for what a search sends.
            icon: None,
        },
        words,
        icon_name: keys.get("Icon").map(|icon| unescaped(icon)),
    })
}

/// The argv an `Exec` value runs, or nothing if it cannot be read.
///
/// Its string escapes first, then its quoting, as the spec orders them. Field
/// codes stand for what a launcher does not hand over — files, URLs, an icon —
/// so they are dropped, and an argument that was only one goes with them.
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

/// The first `limit` applications `query` matches, best first.
///
/// Every word of the query, in any order and ignoring case, in the name, the
/// generic name or a keyword — the file search's rule, so the two halves of a
/// launcher agree about what matching is. A name that starts with the query
/// is best; after that, by name.
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
    // The ID last, so two entries of one name come out in the same order
    // whatever order the directories listed them in.
    matched.sort_by(|a, b| (a.0, &a.1, &a.2.entry.id).cmp(&(b.0, &b.1, &b.2.entry.id)));
    matched
        .into_iter()
        .take(limit)
        .map(|(_, _, entry)| entry)
        .collect()
}

/// Every `.desktop` file under `dir`, with the ID `root` gives it.
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

/// A word ended at a space: kept unless nothing is left of it, which is a
/// field code on its own or a run of spaces.
fn finish(words: &mut Vec<String>, word: &mut String) {
    if !word.is_empty() {
        words.push(std::mem::take(word));
    }
}

/// A string value with the desktop entry spec's escapes read.
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
