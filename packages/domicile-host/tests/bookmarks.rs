//! What a launcher is offered of the desk's bookmarks.

use std::collections::BTreeMap;

use domicile_host::bookmarks::{find, Offered, Shortcode};
use domicile_protocol::Bookmark;

fn bookmark(name: &str, url: &str) -> Offered {
    Offered {
        name: name.into(),
        url: url.into(),
        label: None,
        shortcodes: BTreeMap::new(),
    }
}

fn offered() -> Vec<Offered> {
    vec![
        bookmark("Mail", "https://mail.google.com"),
        Offered {
            label: Some("Home".into()),
            shortcodes: BTreeMap::from([(
                "!work".into(),
                Shortcode {
                    url: "https://calendar.google.com?authuser=work".into(),
                    label: Some("Work".into()),
                },
            )]),
            ..bookmark("Calendar", "https://calendar.google.com")
        },
        bookmark("Code Review", "https://github.com/pulls"),
    ]
}

fn names(found: &[Bookmark]) -> Vec<String> {
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

#[test]
fn a_bookmark_without_a_shortcode_offers_its_url_and_label() {
    assert_eq!(
        find(&offered(), "cal", 10),
        vec![Bookmark {
            name: "Calendar".into(),
            url: "https://calendar.google.com".into(),
            label: Some("Home".into()),
        }]
    );
}

#[test]
fn a_shortcode_in_the_query_offers_its_url_and_label_and_is_not_matched_as_a_word() {
    assert_eq!(
        find(&offered(), "cal !WORK", 10),
        vec![Bookmark {
            name: "Calendar".into(),
            url: "https://calendar.google.com?authuser=work".into(),
            label: Some("Work".into()),
        }]
    );
}
