//! The desk's bookmarks, as a launcher's search matches them.

use domicile_protocol::Bookmark;

/// The bookmarks `query` matches, best first and no more than `limit`.
///
/// [`crate::desktop_entries::find`]'s rule, so a launcher's rows agree about
/// what matching is: every word of the query, ignoring case, in the name or
/// the URL. A name that starts with the query is best; after that, by name.
pub fn find<'a>(bookmarks: &'a [Bookmark], query: &str, limit: usize) -> Vec<&'a Bookmark> {
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
        .map(|(_, _, bookmark)| bookmark)
        .collect()
}
