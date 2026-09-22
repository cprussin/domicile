//! What the desktop remembers having copied, and what it refuses to.
//!
//! The rule is a function over a list, the way `battery`'s is a function over
//! a table: nothing here needs a compositor, a client or a seat, which is what
//! keeps the manager's whole policy — what is a row, what is the same row
//! twice, what is too big to keep — under `cargo test`.

use domicile_host::clipboard::{text_mime, History, LONGEST_COPY, PREVIEW_CHARACTERS, REMEMBERED};
use domicile_protocol::ClipboardEntry;

/// The previews a history is showing, newest first.
fn previews(history: &History) -> Vec<String> {
    history
        .entries()
        .into_iter()
        .map(|entry: ClipboardEntry| entry.preview)
        .collect()
}

/// A copy is a row, and the newest copy is the first one.
///
/// The order is the whole of what a manager is read for: the thing you copied
/// a moment ago and then overwrote is the one you are reaching back for.
#[test]
fn what_was_copied_last_is_the_first_row() {
    let mut history = History::default();

    history.record("first".into());
    history.record("second".into());

    assert_eq!(previews(&history), vec!["second", "first"]);
}

/// Copying something already in the history moves it back to the front rather
/// than putting a second copy of it in the list.
///
/// A person who copies the same address twice in an afternoon has one thing on
/// the clipboard, not two, and a manager that drew it twice would be spending
/// its rows on repeats of what is already at the top.
#[test]
fn copying_something_again_moves_it_up_rather_than_adding_a_row() {
    let mut history = History::default();

    history.record("address".into());
    history.record("something else".into());
    history.record("address".into());

    assert_eq!(previews(&history), vec!["address", "something else"]);
}

/// And it keeps the id it already had.
///
/// The id is what a shell hands back, so re-using it means a panel that was
/// open while the same thing was copied again still names something. A fresh
/// id would make the row the user is looking at name an entry that no longer
/// exists.
#[test]
fn a_row_that_moves_up_keeps_the_id_the_shell_was_told() {
    let mut history = History::default();

    history.record("address".into());
    let first = history.entries()[0].id;
    history.record("something else".into());
    history.record("address".into());

    assert_eq!(history.entries()[0].id, first);
}

/// Copying the same thing twice with nothing in between changes nothing, and
/// says so.
///
/// `record` answers whether the history moved, because what it answers is
/// whether every chrome has to be told — and a client that re-offers the
/// selection it already holds is common enough that believing it would be a
/// broadcast per keystroke in an editor that sets the selection as you drag.
#[test]
fn re_copying_what_is_already_at_the_top_is_not_news() {
    let mut history = History::default();

    assert!(history.record("address".into()));
    assert!(!history.record("address".into()));
}

/// Nothing is not a copy.
///
/// An empty selection is what a client offers while it is clearing one, and a
/// blank row is nothing a person can recognize or want back.
#[test]
fn an_empty_copy_is_not_a_row() {
    let mut history = History::default();

    assert!(!history.record(String::new()));
    assert!(history.entries().is_empty());
}

/// The history has an end, and the oldest row is what falls off it.
///
/// A manager holds what a person might reach back for, which is the last
/// while's worth — not the session's. The bound is on the list rather than on
/// the age, because a desktop left running over a weekend has the same use for
/// its last thirty copies as one started this morning.
#[test]
fn the_oldest_row_falls_off_a_full_history() {
    let mut history = History::default();

    for copy in 0..=REMEMBERED {
        history.record(format!("copy {copy}"));
    }

    let showing = previews(&history);
    assert_eq!(showing.len(), REMEMBERED);
    assert_eq!(showing[0], format!("copy {REMEMBERED}"));
    assert_eq!(showing[REMEMBERED - 1], "copy 1");
}

/// A copy too big to keep is not kept, and does not push out what is.
///
/// A clipboard manager is a desktop-lifetime hold on everything that crosses
/// the clipboard, so a video pasted as text or a log file selected whole is a
/// leak with a list in front of it. The cut-off is honest about what it costs:
/// the selection itself still works — the client that offered it is still the
/// one serving it — and what is lost is being able to reach back for it after
/// something else is copied.
#[test]
fn a_copy_too_big_to_keep_is_refused_and_disturbs_nothing() {
    let mut history = History::default();
    history.record("small".into());

    assert!(!history.record("x".repeat(LONGEST_COPY + 1)));
    assert_eq!(previews(&history), vec!["small"]);
}

/// A long row is cut down to a row, and the copy itself is not.
///
/// The preview is what a shell draws in a list and the text is what goes back
/// on the clipboard; cutting one has nothing to do with the other. This is the
/// pair of assertions that says so.
#[test]
fn a_long_copy_is_shown_cut_and_handed_back_whole() {
    let mut history = History::default();
    let whole = "y".repeat(PREVIEW_CHARACTERS * 2);

    history.record(whole.clone());

    let entry = &history.entries()[0];
    assert_eq!(entry.preview.chars().count(), PREVIEW_CHARACTERS);
    assert_eq!(history.text(entry.id), Some(whole.as_str()));
}

/// The cut is by characters rather than by bytes, so a preview of text that is
/// not ASCII is still text.
///
/// Cutting a UTF-8 string at a byte would split a character in half, and what
/// a page is handed then is either a replacement glyph or a parse error
/// depending on who is reading. Nothing a desktop copies is reliably ASCII —
/// an em dash in a sentence is enough.
#[test]
fn a_preview_is_cut_between_characters() {
    let mut history = History::default();

    history.record("é".repeat(PREVIEW_CHARACTERS + 10));

    let preview = &history.entries()[0].preview;
    assert_eq!(preview.chars().count(), PREVIEW_CHARACTERS);
    assert!(preview.chars().all(|character| character == 'é'));
}

/// An id that names nothing answers with nothing.
///
/// What a shell can hold is an id it was told, and the only way one goes stale
/// is the entry falling off the end of the history. The caller is what decides
/// that is worth a line in the log — see the compositor, which sets no
/// selection and says which id it was asked for.
#[test]
fn an_id_from_no_row_names_no_text() {
    let mut history = History::default();
    history.record("something".into());

    assert_eq!(history.text(u32::MAX), None);
}

/// A row that has fallen off the end takes its text with it.
///
/// The bound on the list is a bound on what is held in memory, and it would
/// not be one if the text stayed reachable by an id nothing draws any more.
#[test]
fn a_row_that_fell_off_the_end_is_not_still_holding_its_text() {
    let mut history = History::default();
    history.record("the first".into());
    let fallen = history.entries()[0].id;

    for copy in 0..REMEMBERED {
        history.record(format!("copy {copy}"));
    }

    assert_eq!(history.text(fallen), None);
}

/// A selection that offers text is asked for it in the spelling this desktop
/// would rather have.
///
/// UTF-8 first, because that is the one every toolkit writing this decade
/// offers and the only one whose bytes need no guessing at.
#[test]
fn a_text_selection_is_asked_for_utf8() {
    let offered = vec![
        "text/plain".to_string(),
        "text/plain;charset=utf-8".to_string(),
        "TIMESTAMP".to_string(),
    ];

    assert_eq!(
        text_mime(&offered).as_deref(),
        Some("text/plain;charset=utf-8")
    );
}

/// The spelling is matched however it was capitalized.
///
/// `text/plain;charset=UTF-8` is what an X11 bridge and a few toolkits write,
/// and a manager that recorded nothing from those would be a manager that is
/// empty on half the desktops it runs on — for a difference in case inside a
/// parameter whose value is case-insensitive by its own registration.
#[test]
fn the_charset_is_matched_however_it_is_capitalized() {
    let offered = vec!["text/plain;charset=UTF-8".to_string()];

    assert_eq!(
        text_mime(&offered).as_deref(),
        Some("text/plain;charset=UTF-8")
    );
}

/// A selection with no text in it is not asked for anything.
///
/// An image or a file drag has nothing this history can hold, and the answer
/// is to leave it alone rather than to record a row with no text behind it:
/// what that would buy is a manager offering a row it cannot hand back.
#[test]
fn a_selection_that_is_not_text_is_left_alone() {
    let offered = vec!["image/png".to_string(), "text/uri-list".to_string()];

    assert_eq!(text_mime(&offered), None);
}
