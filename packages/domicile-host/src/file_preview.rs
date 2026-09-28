//! What a launcher is shown of the row it has reached.
//!
//! **The page names the path, and the index decides whether it is read.** A
//! page has no filesystem, and `preview_file` is not one: a path the index of
//! the home does not hold is answered [`FilePreview::Unreadable`] without
//! touching the disk, so a page learns nothing a search could not already have
//! named.

use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use domicile_protocol::FilePreview;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;

use crate::data_url::data_url;
use crate::file_search::FileSearch;

/// How much of a file a preview is sent. A pane's worth, not a file's.
const PREVIEW_BYTES: usize = 8 * 1024;

/// How many of a directory's entries a preview is sent.
const PREVIEW_ENTRIES: usize = 200;

/// The largest picture of itself a song is sent with. A cover is a pane's
/// worth of picture, and one bigger than this is a scan nobody needs to see in
/// a launcher.
const COVER_BYTES: usize = 1024 * 1024;

/// What `path`, relative to `home`, holds — if `search` offers it.
pub fn preview(home: &Path, path: &str, search: &FileSearch) -> FilePreview {
    let at = home.join(path);
    let read = if !search.holds(path) {
        Ok(FilePreview::Unreadable)
    } else if at.is_dir() {
        listed(&at)
    } else {
        heard(&at).map_or_else(|| front(&at), Ok)
    };
    // A path the walk found and the disk no longer has, or one it will not
    // open: the preview says there is nothing to show rather than a guess.
    read.unwrap_or(FilePreview::Unreadable)
}

/// The front of a directory: its names, sorted, a directory ending in `/`.
fn listed(at: &Path) -> std::io::Result<FilePreview> {
    let mut entries = fs::read_dir(at)?
        .map(|entry| {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            Ok(if entry.file_type()?.is_dir() {
                format!("{name}/")
            } else {
                name
            })
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    entries.sort();
    entries.truncate(PREVIEW_ENTRIES);
    Ok(FilePreview::Directory { entries })
}

/// What a file that plays says about itself, or `None` for one that does not
/// read as sound — whatever its name says, since a name is a guess.
fn heard(at: &Path) -> Option<FilePreview> {
    let song = Probe::open(at).ok()?.guess_file_type().ok()?.read().ok()?;
    let tag = song.primary_tag().or_else(|| song.first_tag());
    Some(FilePreview::Audio {
        title: tag.and_then(|tag| tag.title()).map(Cow::into_owned),
        artist: tag.and_then(|tag| tag.artist()).map(Cow::into_owned),
        album: tag.and_then(|tag| tag.album()).map(Cow::into_owned),
        duration: song.properties().duration().as_secs_f64(),
        cover: tag.and_then(cover),
    })
}

/// The picture a song carries of its front, or the first it carries of
/// anything, as a URL a page can draw. Not one too big to send, and not one
/// that does not say what it is: a page guessing at bytes is how a preview
/// shows garbage.
fn cover(tag: &Tag) -> Option<String> {
    let picture = tag
        .get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
        .filter(|picture| picture.data().len() <= COVER_BYTES)?;
    Some(data_url(picture.mime_type()?.as_str(), picture.data()))
}

/// The front of a file, as text if it is text.
///
/// Binary is a NUL, or bytes that are not UTF-8 before the limit. A character
/// the limit cut in half is not either: it is left out.
fn front(at: &Path) -> std::io::Result<FilePreview> {
    let mut bytes = Vec::with_capacity(PREVIEW_BYTES);
    File::open(at)?
        .take(PREVIEW_BYTES as u64)
        .read_to_end(&mut bytes)?;
    Ok(match std::str::from_utf8(&bytes) {
        _ if bytes.contains(&0) => FilePreview::Binary,
        Ok(text) => FilePreview::Text { text: text.into() },
        Err(error) if error.error_len().is_none() => FilePreview::Text {
            text: String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
        },
        Err(_) => FilePreview::Binary,
    })
}
