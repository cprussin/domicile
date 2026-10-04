//! Searching the file index for the launcher.

use domicile_host::file_search::{FileSearch, Found};

fn home(paths: &[&str]) -> FileSearch {
    FileSearch::new(paths.iter().map(|path| path.to_string()).collect())
}

#[test]
fn every_word_has_to_appear_in_any_order_and_any_case() {
    // Matches `fzf --exact`, as the launcher it is modeled on: no ranking,
    // index order kept.
    let search = home(&["Notes/2026/Plan.org", "plan-b.txt", "src/plan.rs"]);

    assert_eq!(
        search.find("2026 plan", 10),
        Found {
            files: vec!["Notes/2026/Plan.org".to_string()],
            matched: 1,
        }
    );
}

#[test]
fn only_the_front_of_what_matched_is_sent_and_all_of_it_is_counted() {
    // A home has hundreds of thousands of paths, but the panel shows a few
    // rows, so results are capped here.
    let search = home(&["a1", "a2", "a3", "b"]);

    assert_eq!(
        search.find("a", 2),
        Found {
            files: vec!["a1".to_string(), "a2".to_string()],
            matched: 3,
        }
    );
}

#[test]
fn an_empty_query_finds_everything() {
    let search = home(&["a", "b"]);

    assert_eq!(search.find("  ", 10).matched, 2);
}

#[test]
fn a_directory_is_marked_with_a_slash_whether_or_not_what_is_in_it_matched() {
    // A page has no filesystem, so the host marks directories. `Notes-old`
    // sorts between `Notes` and `Notes/…`, so checking only the next path is
    // wrong.
    let search = home(&["Notes", "Notes-old", "Notes/today.org"]);

    assert_eq!(
        search.find("notes", 10).files,
        vec![
            "Notes/".to_string(),
            "Notes-old".to_string(),
            "Notes/today.org".to_string(),
        ]
    );
}
