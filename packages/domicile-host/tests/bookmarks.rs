//! What a launcher is offered of the desk's bookmarks.

use domicile_host::bookmarks::find;
use domicile_protocol::Bookmark;

fn bookmark(name: &str, url: &str) -> Bookmark {
    Bookmark {
        name: name.into(),
        url: url.into(),
    }
}

fn offered() -> Vec<Bookmark> {
    vec![
        bookmark("Mail", "https://mail.google.com"),
        bookmark("Calendar", "https://calendar.google.com"),
        bookmark("Code Review", "https://github.com/pulls"),
    ]
}

fn names(found: &[&Bookmark]) -> Vec<String> {
    found.iter().map(|found| found.name.clone()).collect()
}

#[test]
fn every_word_matches_the_name_or_the_url_ignoring_case() {
    assert_eq!(names(&find(&offered(), "REVIEW", 10)), vec!["Code Review"]);
    assert_eq!(
        names(&find(&offered(), "github pulls", 10)),
        vec!["Code Review"]
    );
    assert!(find(&offered(), "mail nope", 10).is_empty());
}

#[test]
fn a_name_that_starts_with_the_query_comes_first_then_by_name() {
    assert_eq!(
        names(&find(&offered(), "c", 10)),
        vec!["Calendar", "Code Review", "Mail"]
    );
}

#[test]
fn no_more_than_the_limit_is_offered() {
    assert_eq!(
        names(&find(&offered(), "", 2)),
        vec!["Calendar", "Code Review"]
    );
}
