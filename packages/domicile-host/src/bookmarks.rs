//! Launcher search over bookmarks.

use domicile_protocol::Bookmark;

/// Up to `limit` bookmarks matching `query`, best first.
///
/// Matches like [`crate::desktop_entries::find`] so launcher rows agree: every
/// query word must appear, case-insensitively, in the name or URL. Names that
/// start with the query rank first, then sort by name.
pub fn find(bookmarks: &[Bookmark], query: &str, limit: usize) -> Vec<Bookmark> {
    let query = query.trim().to_lowercase();
    let words: Vec<&str> = query.split_whitespace().collect();
    let mut matched: Vec<(bool, String, &Bookmark)> = bookmarks
        .iter()
        .filter(|bookmark| {
            let text = format!("{} {}", bookmark.name, bookmark.url).to_lowercase();
            words.iter().all(|word| text.contains(word))
        })
        .map(|bookmark| {
            let name = bookmark.name.to_lowercase();
            (!name.starts_with(&query), name, bookmark)
        })
        .collect();
    matched.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    matched
        .into_iter()
        .take(limit)
        .map(|(_, _, bookmark)| bookmark.clone())
        .collect()
}
