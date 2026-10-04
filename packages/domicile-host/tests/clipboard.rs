//! Clipboard history policy: what is a row, what counts as a repeat, and
//! what is too big to keep.

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

/// A copy becomes the first row.
#[test]
fn what_was_copied_last_is_the_first_row() {
    let mut history = History::default();

    history.record("first".into());
    history.record("second".into());

    assert_eq!(previews(&history), vec!["second", "first"]);
}

/// Copying something already in the history moves it to the front instead
/// of adding a duplicate.
#[test]
fn copying_something_again_moves_it_up_rather_than_adding_a_row() {
    let mut history = History::default();

    history.record("address".into());
    history.record("something else".into());
    history.record("address".into());

    assert_eq!(previews(&history), vec!["address", "something else"]);
}

/// A repeated copy keeps its id, so an open panel's rows still name live
/// entries.
#[test]
fn a_row_that_moves_up_keeps_the_id_the_shell_was_told() {
    let mut history = History::default();

    history.record("address".into());
    let first = history.entries()[0].id;
    history.record("something else".into());
    history.record("address".into());

    assert_eq!(history.entries()[0].id, first);
}

/// Copying the same thing twice in a row reports no change.
///
/// Clients often re-offer their current selection, for example while
/// dragging in an editor. Reporting each as a change would broadcast per
/// keystroke.
#[test]
fn re_copying_what_is_already_at_the_top_is_not_news() {
    let mut history = History::default();

    assert!(history.record("address".into()));
    assert!(!history.record("address".into()));
}

/// An empty selection is not recorded. Clients offer one while clearing.
#[test]
fn an_empty_copy_is_not_a_row() {
    let mut history = History::default();

    assert!(!history.record(String::new()));
    assert!(history.entries().is_empty());
}

/// The history is bounded by count, and the oldest row is dropped.
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

/// A copy too big to keep is not recorded and does not evict anything.
///
/// The selection still works; only reaching back for it later is lost.
#[test]
fn a_copy_too_big_to_keep_is_refused_and_disturbs_nothing() {
    let mut history = History::default();
    history.record("small".into());

    assert!(!history.record("x".repeat(LONGEST_COPY + 1)));
    assert_eq!(previews(&history), vec!["small"]);
}

/// A long preview is truncated; the copied text is not.
#[test]
fn a_long_copy_is_shown_cut_and_handed_back_whole() {
    let mut history = History::default();
    let whole = "y".repeat(PREVIEW_CHARACTERS * 2);

    history.record(whole.clone());

    let entry = &history.entries()[0];
    assert_eq!(entry.preview.chars().count(), PREVIEW_CHARACTERS);
    assert_eq!(history.text(entry.id), Some(whole.as_str()));
}

/// The preview is truncated by characters, not bytes, so non-ASCII text
/// is not split mid-character.
#[test]
fn a_preview_is_cut_between_characters() {
    let mut history = History::default();

    history.record("é".repeat(PREVIEW_CHARACTERS + 10));

    let preview = &history.entries()[0].preview;
    assert_eq!(preview.chars().count(), PREVIEW_CHARACTERS);
    assert!(preview.chars().all(|character| character == 'é'));
}

/// An unknown id returns nothing. The caller logs it.
#[test]
fn an_id_from_no_row_names_no_text() {
    let mut history = History::default();
    history.record("something".into());

    assert_eq!(history.text(u32::MAX), None);
}

/// A dropped row's text is freed too.
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

/// A text selection is requested as UTF-8 first.
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

/// The MIME type matches case-insensitively, as for
/// `text/plain;charset=UTF-8` from X11 bridges and some toolkits.
#[test]
fn the_charset_is_matched_however_it_is_capitalized() {
    let offered = vec!["text/plain;charset=UTF-8".to_string()];

    assert_eq!(
        text_mime(&offered).as_deref(),
        Some("text/plain;charset=UTF-8")
    );
}

/// A selection with no text type is not requested, since its row could not
/// be pasted back.
#[test]
fn a_selection_that_is_not_text_is_left_alone() {
    let offered = vec!["image/png".to_string(), "text/uri-list".to_string()];

    assert_eq!(text_mime(&offered), None);
}

/// The id of the newest row, for the compositor to offer.
///
/// A browser copy is offered by the compositor, which needs the row's id
/// right away; `record` only reports whether the list changed.
#[test]
fn the_newest_row_is_the_one_a_copy_just_made() {
    let mut history = History::default();

    history.record("first".to_string());
    history.record("second".to_string());

    let newest = history.newest().expect("a history with rows has a newest");
    assert_eq!(history.text(newest), Some("second"));
}

/// Re-copying the current entry still returns its id, so the browser sets
/// the selection both times.
#[test]
fn copying_the_same_thing_twice_still_names_its_row() {
    let mut history = History::default();
    history.record("once".to_string());

    assert!(!history.record("once".to_string()));

    let newest = history.newest().expect("a history with rows has a newest");
    assert_eq!(history.text(newest), Some("once"));
}

/// An empty history has no newest row.
#[test]
fn a_history_with_no_rows_has_no_newest() {
    assert_eq!(History::default().newest(), None);
}
