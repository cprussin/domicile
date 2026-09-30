//! The desk's bookmarks, as a launcher's search matches them.

use std::collections::BTreeMap;

use domicile_protocol::Bookmark;

/// A bookmark as the desk offers it: a name, its URL, and the other URLs a
/// shortcode in the query opens instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offered {
    /// What a launcher's row says, and what a query is matched against with
    /// the URL.
    pub name: String,
    /// What choosing it opens when the query holds none of its shortcodes.
    pub url: String,
    /// A word, `!mp` say, and the URL a query holding it opens instead.
    pub shortcodes: BTreeMap<String, String>,
}

/// The bookmarks `query` matches, best first and no more than `limit`.
///
/// [`crate::desktop_entries::find`]'s rule, so a launcher's rows agree about
/// what matching is: every word of the query, ignoring case, in the name or
/// the URL. A name that starts with the query is best; after that, by name.
///
/// A word that is one of a bookmark's shortcodes, ignoring case, is not
/// matched: it picks the URL that bookmark offers, the first such word
/// winning, and the other words are matched against that URL and ranked
/// without it. To any other bookmark it is a word like the rest.
pub fn find(bookmarks: &[Offered], query: &str, limit: usize) -> Vec<Bookmark> {
    let query = query.to_lowercase();
    let words: Vec<&str> = query.split_whitespace().collect();
    let mut matched: Vec<(bool, String, Bookmark)> = bookmarks
        .iter()
        .filter_map(|bookmark| matched(bookmark, &words))
        .collect();
    matched.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    matched
        .into_iter()
        .take(limit)
        .map(|(_, _, bookmark)| bookmark)
        .collect()
}

/// `bookmark` as `words` pick it, with what it sorts by, if they match it.
fn matched(bookmark: &Offered, words: &[&str]) -> Option<(bool, String, Bookmark)> {
    let (shortcodes, words): (Vec<&str>, Vec<&str>) = words
        .iter()
        .partition(|word| shortcode(bookmark, word).is_some());
    let url = shortcodes
        .first()
        .and_then(|word| shortcode(bookmark, word))
        .unwrap_or(&bookmark.url);
    let text = format!("{} {}", bookmark.name, url).to_lowercase();
    let name = bookmark.name.to_lowercase();
    words.iter().all(|word| text.contains(word)).then(|| {
        (
            !name.starts_with(&words.join(" ")),
            name,
            Bookmark {
                name: bookmark.name.clone(),
                url: url.clone(),
            },
        )
    })
}

/// The URL `word` is `bookmark`'s shortcode for, ignoring case.
fn shortcode<'a>(bookmark: &'a Offered, word: &str) -> Option<&'a String> {
    bookmark
        .shortcodes
        .iter()
        .find(|(code, _)| code.to_lowercase() == word)
        .map(|(_, url)| url)
}
