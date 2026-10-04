//! Clipboard history policy: what is kept, deduplicated and previewed.
//!
//! A Wayland selection lives in the offering client, so it vanishes when that
//! client exits. The compositor keeps copies to survive that. Reading and
//! restoring selections is in `domicile-compositor`'s `clipboard` module. See
//! `packages/shell-manganese/docs/CLIPBOARD.md`.

use domicile_protocol::ClipboardEntry;

/// Number of copies kept. Bounded by count, not age.
pub const REMEMBERED: usize = 32;

/// Largest copy kept, in bytes, to bound memory.
///
/// A larger copy still pastes from its client but is not added to history.
pub const LONGEST_COPY: usize = 1024 * 1024;

/// Characters of each copy sent to the shell as a preview. Restoring a copy
/// always uses the full text.
pub const PREVIEW_CHARACTERS: usize = 160;

/// Text MIME types, preferred first.
///
/// Used both to read a selection and to offer a restored one, so anything
/// kept can be pasted back. `UTF8_STRING` and `STRING` are X11 names that
/// arrive through Xwayland.
pub const TEXT_MIMES: [&str; 4] = [
    "text/plain;charset=utf-8",
    "text/plain",
    "UTF8_STRING",
    "STRING",
];

/// The MIME type to read a selection as, or `None` if it has no text (for
/// example an image), which is not kept.
///
/// Case-insensitive: X11 bridges write `text/plain;charset=UTF-8`, and the
/// charset value is case-insensitive.
pub fn text_mime(offered: &[String]) -> Option<String> {
    TEXT_MIMES.iter().find_map(|wanted| {
        offered
            .iter()
            .find(|mime| mime.eq_ignore_ascii_case(wanted))
            .cloned()
    })
}

/// Copied text, newest first.
///
/// Kept in memory only, never on disk, because it may hold passwords.
#[derive(Debug, Default)]
pub struct History {
    /// Newest first.
    entries: Vec<Copy>,
    /// Total entries ever taken, which is also the last id issued. Never
    /// reset, so a stale id never names a different row.
    taken: u32,
}

/// One copied text and its id.
#[derive(Debug)]
struct Copy {
    id: u32,
    text: String,
}

impl History {
    /// Records a copy and returns whether the list changed and needs to be
    /// broadcast.
    ///
    /// Clients often re-offer the current selection, such as an editor during
    /// a drag, so a repeat of the newest entry returns `false`.
    pub fn record(&mut self, text: String) -> bool {
        if text.is_empty() || text.len() > LONGEST_COPY {
            false
        } else {
            self.remember(text)
        }
    }

    /// Every entry, as sent to a chrome.
    pub fn entries(&self) -> Vec<ClipboardEntry> {
        self.entries
            .iter()
            .map(|copy| ClipboardEntry {
                id: copy.id,
                preview: copy.text.chars().take(PREVIEW_CHARACTERS).collect(),
            })
            .collect()
    }

    /// The newest entry's id, or `None` if nothing has been copied.
    ///
    /// After [`History::record`], this is the entry for that copy, even when
    /// `record` returned `false`.
    pub fn newest(&self) -> Option<u32> {
        self.entries.first().map(|copy| copy.id)
    }

    /// The full text of entry `id`, for restoring it to the clipboard.
    ///
    /// `None` if the entry has dropped off the end of the history.
    pub fn text(&self, id: u32) -> Option<&str> {
        self.entries
            .iter()
            .find(|copy| copy.id == id)
            .map(|copy| copy.text.as_str())
    }

    /// Puts a copy at the front, moving an existing equal entry instead of
    /// duplicating it.
    ///
    /// A moved entry keeps its id, so an open panel's rows stay valid.
    fn remember(&mut self, text: String) -> bool {
        match self.entries.iter().position(|copy| copy.text == text) {
            // Already newest, so nothing changed.
            Some(0) => false,
            Some(held) => {
                let copy = self.entries.remove(held);
                self.entries.insert(0, copy);
                true
            }
            None => {
                self.taken += 1;
                self.entries.insert(
                    0,
                    Copy {
                        id: self.taken,
                        text,
                    },
                );
                // Drop the oldest entry and its text to bound memory.
                self.entries.truncate(REMEMBERED);
                true
            }
        }
    }
}
