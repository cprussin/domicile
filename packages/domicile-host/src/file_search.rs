//! What a launcher's query finds in the file index.
//!
//! **The page asks and the compositor looks.** The index is the whole home —
//! hundreds of thousands of paths on a real one — and it used to cross into
//! the page whole, on every change, so that a launcher could filter it there.
//! Each crossing was tens of megabytes through the engine's control channel,
//! and a desktop that took no input while one was in flight. A query is a few
//! bytes and its answer is a panel of rows, so the filter is here.
//!
//! The matching is `fzf --exact`, which is what the launcher this desktop is
//! modeled on filters with: every word has to appear somewhere in the path, in
//! any order, ignoring case. No ranking and no reordering — the index is
//! already sorted, and a second rule about order would be a second chance for
//! the list to jump around under a keystroke that only narrowed it.

/// The index, in the form a query reads.
///
/// Built once per change to the index rather than once per query, because the
/// folding is what costs: on 120,000 paths, lowering them is 28 ms and
/// scanning the lowered ones is 5.
#[derive(Debug, Default)]
pub struct FileSearch {
    /// The paths, in the index's byte order.
    paths: Vec<String>,
    /// `paths` in lower case, which is the only form a query compares against.
    lowered: Vec<String>,
}

/// What a query found.
#[derive(Debug, PartialEq)]
pub struct Found {
    /// The front of what matched, in the index's order.
    ///
    /// A directory ends in `/`. A page has no filesystem to ask, and the index
    /// holds names rather than kinds, so the evidence is the host's: a path
    /// that another path is inside of cannot be anything else.
    pub files: Vec<String>,
    /// How many matched, of which `files` is the front.
    pub matched: usize,
}

impl FileSearch {
    /// The search over `paths`, which are in the index's byte order.
    pub fn new(paths: Vec<String>) -> Self {
        let lowered = paths.iter().map(|path| path.to_lowercase()).collect();
        FileSearch { paths, lowered }
    }

    /// The first `limit` paths that `query` matches, and how many it matched.
    pub fn find(&self, query: &str, limit: usize) -> Found {
        let query = query.to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        let mut matched = self
            .paths
            .iter()
            .zip(&self.lowered)
            .filter(|(_, lowered)| words.iter().all(|word| lowered.contains(word)))
            .map(|(path, _)| path);
        let files = matched
            .by_ref()
            .take(limit)
            .map(|path| self.marked(path))
            .collect::<Vec<_>>();
        Found {
            matched: files.len() + matched.count(),
            files,
        }
    }

    /// `path`, with a `/` after it if anything is inside it.
    ///
    /// A binary search rather than a look at the next path, because the next
    /// path in byte order need not be inside it: `Notes-old` sorts between
    /// `Notes` and `Notes/today.org`.
    fn marked(&self, path: &str) -> String {
        let inside = format!("{path}/");
        let next = self.paths.partition_point(|other| *other < inside);
        match self.paths.get(next) {
            Some(other) if other.starts_with(&inside) => inside,
            _ => path.to_string(),
        }
    }
}
