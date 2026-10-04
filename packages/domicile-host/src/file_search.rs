//! Searches the file index for the launcher.
//!
//! The search runs in the compositor because the index can hold hundreds of
//! thousands of paths, too many to send to the page.
//!
//! Matches like `fzf --exact`: every query word must appear in the path,
//! case-insensitively. Results keep index order, so narrowing a query does not
//! reorder the list.

/// A searchable snapshot of the file index.
///
/// Rebuild it per index change, not per query: lowercasing 120,000 paths takes
/// 28 ms, while scanning them takes 5 ms.
#[derive(Debug, Default)]
pub struct FileSearch {
    /// Paths in byte order.
    paths: Vec<String>,
    /// `paths` lowercased, for matching.
    lowered: Vec<String>,
}

/// A query's results.
#[derive(Debug, PartialEq)]
pub struct Found {
    /// The first matches, in index order.
    ///
    /// A path with other paths under it ends in `/`, marking it a directory.
    pub files: Vec<String>,
    /// The total number of matches.
    pub matched: usize,
}

impl FileSearch {
    /// A search over `paths`, which must be in byte order.
    pub fn new(paths: Vec<String>) -> Self {
        let lowered = paths.iter().map(|path| path.to_lowercase()).collect();
        FileSearch { paths, lowered }
    }

    /// The first `limit` matches for `query`, and the total match count.
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

    /// Whether the index holds `path`. Previews may read only such paths.
    pub fn holds(&self, path: &str) -> bool {
        self.paths
            .binary_search_by(|other| other.as_str().cmp(path))
            .is_ok()
    }

    /// `path`, with a trailing `/` if anything is under it.
    ///
    /// Searches for `path/` rather than checking the next path, because
    /// `Notes-old` sorts between `Notes` and `Notes/today.org`.
    fn marked(&self, path: &str) -> String {
        let inside = format!("{path}/");
        let next = self.paths.partition_point(|other| *other < inside);
        match self.paths.get(next) {
            Some(other) if other.starts_with(&inside) => inside,
            _ => path.to_string(),
        }
    }
}
