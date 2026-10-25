//! A file's content type, a type's aliases and its supertypes, from
//! shared-mime-info's `mime/globs2`, `mime/aliases` and `mime/subclasses`. See
//! <https://specifications.freedesktop.org/shared-mime-info-spec/latest/>.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read as _};
use std::os::unix::fs::FileTypeExt as _;
use std::path::{Path, PathBuf};

use globset::GlobBuilder;

/// The type the spec makes every other `text/*` type a subclass of.
const TEXT: &str = "text/plain";

/// The type of data that is not text.
const BYTES: &str = "application/octet-stream";

/// How much of a file is read to tell text from bytes.
const SNIFFED: u64 = 4096;

/// The `globs2` pattern that drops a type's globs from lower-priority
/// directories.
const NO_GLOBS: &str = "__NOGLOBS__";

/// `path`'s content type.
///
/// - A directory, FIFO, socket or device is its `inode/*` type, and is not
///   read.
/// - A file is the type of the heaviest `mime/globs2` glob under `data_dirs`
///   matching its name, then the longest, then the earliest directory's. A
///   type's `__NOGLOBS__` drops its globs from later directories. Missing
///   `globs2` files are skipped; unreadable ones are an error.
/// - A file no glob matches is `text/plain` if its start is UTF-8 without
///   control characters other than whitespace and backspace, as GIO guesses,
///   and `application/octet-stream` otherwise. An empty file is text, so it
///   opens in an editor. Magic is not read.
pub fn content_type(path: &Path, data_dirs: &[PathBuf]) -> io::Result<String> {
    let kind = fs::metadata(path)?.file_type();
    let inode = if kind.is_dir() {
        Some("inode/directory")
    } else if kind.is_fifo() {
        Some("inode/fifo")
    } else if kind.is_socket() {
        Some("inode/socket")
    } else if kind.is_char_device() {
        Some("inode/chardevice")
    } else if kind.is_block_device() {
        Some("inode/blockdevice")
    } else {
        None
    };
    if let Some(inode) = inode {
        return Ok(inode.to_string());
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    let globbed = globs(data_dirs)?
        .into_iter()
        .enumerate()
        .filter(|(_, glob)| glob.matches(&name))
        // The earliest wins a tie, so its position counts against it.
        .max_by_key(|(at, glob)| (glob.weight, glob.pattern.len(), std::cmp::Reverse(*at)))
        .map(|(_, glob)| glob.mime);
    match globbed {
        Some(mime) => Ok(mime),
        None => sniffed(path),
    }
}

/// The other names `mime/aliases` under `data_dirs` gives the canonical type
/// `mime`, in order. Missing files are skipped; unreadable ones are an error.
pub fn aliases(mime: &str, data_dirs: &[PathBuf]) -> io::Result<Vec<String>> {
    let mut found = Vec::new();
    for (alias, canonical) in pairs(data_dirs, "mime/aliases")? {
        if canonical == mime && !found.contains(&alias) {
            found.push(alias);
        }
    }
    Ok(found)
}

/// `mime`'s supertypes, nearest first, without `mime` itself.
///
/// Parents are read from `mime/subclasses` under `data_dirs` and followed to
/// their own. Missing files are skipped; unreadable ones are an error. Every
/// `text/*` type is also a `text/plain`.
pub fn supertypes(mime: &str, data_dirs: &[PathBuf]) -> io::Result<Vec<String>> {
    let subclasses = pairs(data_dirs, "mime/subclasses")?;
    let mut seen = vec![mime.to_string()];
    let mut level = vec![mime.to_string()];
    while !level.is_empty() {
        let mut next = Vec::new();
        for parent in level.iter().flat_map(|child| parents(&subclasses, child)) {
            if !seen.contains(&parent) {
                seen.push(parent.clone());
                next.push(parent);
            }
        }
        level = next;
    }
    Ok(seen.split_off(1))
}

/// The text of `name` under each of `data_dirs` that has one.
fn texts(data_dirs: &[PathBuf], name: &str) -> io::Result<Vec<String>> {
    let mut texts = Vec::new();
    for dir in data_dirs {
        match fs::read_to_string(dir.join(name)) {
            Ok(text) => texts.push(text),
            Err(why) if why.kind() == io::ErrorKind::NotFound => {}
            Err(why) => {
                return Err(io::Error::new(
                    why.kind(),
                    format!("cannot read {}: {why}", dir.join(name).display()),
                ))
            }
        }
    }
    Ok(texts)
}

/// The `first second` lines of `name` under `data_dirs`.
fn pairs(data_dirs: &[PathBuf], name: &str) -> io::Result<Vec<(String, String)>> {
    Ok(texts(data_dirs, name)?
        .iter()
        .flat_map(|text| text.lines())
        .filter_map(|line| line.split_once(' '))
        .map(|(first, second)| (first.to_string(), second.to_string()))
        .collect())
}

/// One `globs2` line.
struct Glob {
    weight: u32,
    mime: String,
    pattern: String,
    matcher: globset::GlobMatcher,
}

impl Glob {
    fn matches(&self, name: &str) -> bool {
        self.matcher.is_match(name)
    }
}

/// The globs under `data_dirs`, highest priority first, less those a
/// higher-priority directory's `__NOGLOBS__` drops.
fn globs(data_dirs: &[PathBuf]) -> io::Result<Vec<Glob>> {
    let mut dropped: HashSet<String> = HashSet::new();
    let mut all = Vec::new();
    for text in texts(data_dirs, "mime/globs2")? {
        let (none, some): (Vec<Glob>, Vec<Glob>) = globs_in(&text)
            .into_iter()
            .filter(|glob| !dropped.contains(&glob.mime))
            .partition(|glob| glob.pattern == NO_GLOBS);
        dropped.extend(none.into_iter().map(|glob| glob.mime));
        all.extend(some);
    }
    Ok(all)
}

/// The globs `text` lists, as `weight:type:glob[:flags]`. Lines that do not
/// read are skipped, as the spec says of unknown content.
fn globs_in(text: &str) -> Vec<Glob> {
    text.lines()
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| {
            let mut fields = line.split(':');
            let weight = fields.next()?.parse().ok()?;
            let mime = fields.next()?.to_string();
            let pattern = fields.next()?.to_string();
            let case_sensitive = fields
                .next()
                .is_some_and(|flags| flags.split(',').any(|flag| flag == "cs"));
            let matcher = GlobBuilder::new(&without_alternation(&pattern))
                .case_insensitive(!case_sensitive)
                .build()
                .ok()?
                .compile_matcher();
            Some(Glob {
                weight,
                mime,
                pattern,
                matcher,
            })
        })
        .collect()
}

/// `pattern` with each brace outside a `[...]` class made literal: fnmatch has
/// no `{a,b}` alternation.
fn without_alternation(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len());
    let mut class = false;
    for c in pattern.chars() {
        match (c, class) {
            ('[', false) => {
                class = true;
                out.push(c);
            }
            (']', true) => {
                class = false;
                out.push(c);
            }
            ('{' | '}', false) => {
                out.push('[');
                out.push(c);
                out.push(']');
            }
            _ => out.push(c),
        }
    }
    out
}

/// `child`'s own parents: those `subclasses` lists, then `text/plain` for
/// text.
fn parents(subclasses: &[(String, String)], child: &str) -> Vec<String> {
    subclasses
        .iter()
        .filter(|(listed, _)| listed == child)
        .map(|(_, parent)| parent.clone())
        .chain((child.starts_with("text/") && child != TEXT).then(|| TEXT.to_string()))
        .collect()
}

/// `text/plain` or `application/octet-stream`, by the start of `path`.
fn sniffed(path: &Path) -> io::Result<String> {
    let mut start = Vec::new();
    File::open(path)?.take(SNIFFED).read_to_end(&mut start)?;
    let cut = start.len() as u64 == SNIFFED;
    let utf8 = std::str::from_utf8(&start).map_or_else(
        // A character cut off where the read stopped is still text.
        |why| cut && why.error_len().is_none(),
        |_| true,
    );
    // GIO's whitespace, which counts a vertical tab.
    let plain = start.iter().all(|&byte| {
        !byte.is_ascii_control() || byte.is_ascii_whitespace() || matches!(byte, b'\x08' | b'\x0b')
    });
    Ok(if utf8 && plain { TEXT } else { BYTES }.to_string())
}
