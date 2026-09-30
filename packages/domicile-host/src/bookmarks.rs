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
    /// Which of the bookmark's URLs `url` is, for a launcher's row to say.
    pub label: Option<String>,
    /// A word, `!mp` say, and what a query holding it opens instead.
    pub shortcodes: BTreeMap<String, Shortcode>,
}

/// What a bookmark opens when a query holds one of its shortcodes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shortcode {
    /// What choosing the bookmark opens.
    pub url: String,
    /// Which of the bookmark's URLs this is, for a launcher's row to say.
    pub label: Option<String>,
}

/// The bookmarks `query` matches, best first and no more than `limit`.
///
/// [`crate::desktop_entries::find`]'s rule, so a launcher's rows agree about
/// what matching is: every word of the query, ignoring case, in the name or
/// the URL. A name that starts with the query is best; after that, by name.
///
/// A word that is one of a bookmark's shortcodes, ignoring case, is not
/// matched: it picks the URL and label that bookmark offers, the first such
/// word winning, and the other words are matched against that URL and ranked
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
    let (url, label) = shortcodes
        .first()
        .and_then(|word| shortcode(bookmark, word))
        .map_or((&bookmark.url, &bookmark.label), |picked| {
            (&picked.url, &picked.label)
        });
    let text = format!("{} {}", bookmark.name, url).to_lowercase();
    let name = bookmark.name.to_lowercase();
    words.iter().all(|word| text.contains(word)).then(|| {
        (
            !name.starts_with(&words.join(" ")),
            name,
            Bookmark {
                name: bookmark.name.clone(),
                url: url.clone(),
                label: label.clone(),
            },
        )
    })
}

/// What `word` is `bookmark`'s shortcode for, ignoring case.
fn shortcode<'a>(bookmark: &'a Offered, word: &str) -> Option<&'a Shortcode> {
    bookmark
        .shortcodes
        .iter()
        .find(|(code, _)| code.to_lowercase() == word)
        .map(|(_, picked)| picked)
}
