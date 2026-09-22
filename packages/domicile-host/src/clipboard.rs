//! What has been copied on this desktop, and which of it is worth keeping.
//!
//! **A Wayland clipboard is the client that offered it.** `set_selection`
//! hands the compositor a source object and nothing else: every paste is the
//! offering client being asked to write the bytes again, so closing the
//! terminal you copied out of empties the clipboard. That is the behavior a
//! clipboard manager exists to undo, and it can only be undone by the process
//! the offer arrives at — which is the compositor, the way the charge is.
//!
//! What is here is the policy and none of the plumbing: what counts as a row,
//! when two copies are one row, how much of a copy a shell is shown and how
//! much is too much to keep. Reading the bytes out of a client and putting
//! them back on the seat are the compositor's, over a pipe and a `wl_seat`
//! that no unit test should need — see `domicile-compositor`'s own
//! `clipboard` module for that half.

use domicile_protocol::ClipboardEntry;

/// How many copies back a person can reach.
///
/// The bound is on the list rather than on the age: a desktop left running
/// over a weekend has the same use for its last thirty copies as one started
/// this morning, and an hour is not a unit anybody reaches back in.
pub const REMEMBERED: usize = 32;

/// The most of one copy this will hold, in bytes.
///
/// **A manager is a desktop-lifetime hold on everything that crosses the
/// clipboard**, so without a ceiling a log file selected whole is a leak with
/// a list in front of it. A megabyte is far past anything a person copies to
/// paste somewhere by hand and far short of anything that matters to hold
/// thirty-two of.
///
/// What a refusal costs is worth being clear about: the selection itself still
/// works, because the client that offered it is still the one serving it. What
/// is lost is reaching back for it after something else has been copied.
pub const LONGEST_COPY: usize = 1024 * 1024;

/// How much of a copy a shell is shown.
///
/// A row in a list, and that is the unit — long enough that two paragraphs
/// starting the same way are still telling apart, short enough that the panel
/// is a list rather than a document. What goes back on the clipboard is always
/// the whole thing.
pub const PREVIEW_CHARACTERS: usize = 160;

/// The spellings this desktop knows a copy by, best first.
///
/// Both halves of the clipboard: what a client's selection is asked for, and
/// what the compositor offers when it puts an entry back. Offering exactly the
/// names it accepts is what keeps a copy that went in able to come back out.
///
/// UTF-8 first: it is what every toolkit writing this decade offers, and the
/// only one of these whose bytes need no guessing at. `UTF8_STRING` and
/// `STRING` are X11's names, which arrive here through Xwayland and through
/// the bridges that speak to it.
pub const TEXT_MIMES: [&str; 4] = [
    "text/plain;charset=utf-8",
    "text/plain",
    "UTF8_STRING",
    "STRING",
];

/// Which mime type to ask a selection for, or `None` for a selection with no
/// text in it.
///
/// `None` is an image or a file drag, and the answer to one is to leave it
/// alone: a row with no text behind it would be a manager offering something
/// it cannot hand back.
///
/// Matched without regard to case, because `text/plain;charset=UTF-8` is what
/// an X11 bridge writes and the charset parameter's own registration says the
/// value is case-insensitive. A manager that took the case literally would be
/// empty on half the desktops it runs on.
pub fn text_mime(offered: &[String]) -> Option<String> {
    TEXT_MIMES.iter().find_map(|wanted| {
        offered
            .iter()
            .find(|mime| mime.eq_ignore_ascii_case(wanted))
            .cloned()
    })
}

/// What has been copied, newest first.
///
/// In memory and never on disk, which is not an omission: a password
/// manager's copy is a row in here, and a history that survived a reboot would
/// be one that survived the reason you rebooted. A desktop that has just
/// started has an empty one, and that is an answer rather than a gap.
#[derive(Debug, Default)]
pub struct History {
    /// Newest first. A `Vec` rather than a map because the order *is* the
    /// answer and thirty-two is a length nothing needs an index into.
    entries: Vec<Copy>,
    /// How many entries this has ever taken, which is also the last id it
    /// handed out. Never reset, so an id a shell is holding either names the
    /// row it was told about or names nothing at all.
    taken: u32,
}

/// One thing that was copied, with the text a preview was cut from.
#[derive(Debug)]
struct Copy {
    id: u32,
    text: String,
}

impl History {
    /// Take a copy, and say whether the chromes have to be told.
    ///
    /// The answer is whether the list *moved*, not whether it was handed
    /// something: a client that re-offers the selection it already holds is
    /// ordinary — an editor setting it as a drag goes on — and believing each
    /// of those would be a broadcast per mouse move.
    pub fn record(&mut self, text: String) -> bool {
        if text.is_empty() || text.len() > LONGEST_COPY {
            false
        } else {
            self.remember(text)
        }
    }

    /// Every row, in the shape a chrome is told it.
    pub fn entries(&self) -> Vec<ClipboardEntry> {
        self.entries
            .iter()
            .map(|copy| ClipboardEntry {
                id: copy.id,
                preview: copy.text.chars().take(PREVIEW_CHARACTERS).collect(),
            })
            .collect()
    }

    /// The whole of what a row holds, for putting back on the clipboard.
    ///
    /// `None` for an id no row has, which is an id whose row fell off the end
    /// of the history — the one way an id a shell was told goes stale. The
    /// caller decides what to say about it; nothing here invents a selection
    /// to answer with.
    pub fn text(&self, id: u32) -> Option<&str> {
        self.entries
            .iter()
            .find(|copy| copy.id == id)
            .map(|copy| copy.text.as_str())
    }

    /// Put a copy at the front, moving it rather than duplicating it when the
    /// history already holds it.
    ///
    /// The moved row keeps its id: a panel that was open while the same thing
    /// was copied again still names something, where a fresh id would leave
    /// the row under the user's cursor naming an entry that no longer exists.
    fn remember(&mut self, text: String) -> bool {
        match self.entries.iter().position(|copy| copy.text == text) {
            // Already the newest thing there is, so nothing moved.
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
                // The oldest goes, and its text goes with it — a bound on the
                // list is only a bound on memory if nothing keeps the bytes
                // alive behind it.
                self.entries.truncate(REMEMBERED);
                true
            }
        }
    }
}
