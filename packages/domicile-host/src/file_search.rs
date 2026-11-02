//! Searches the file index for the launcher.
//!
//! The search runs in the compositor because the index can hold hundreds of
//! thousands of paths, too many to send to the page.
//!
//! Matches like `fzf --exact`: every query word must appear in the path,
//! case-insensitively. Paths whose name holds a query word come first, then
//! paths that match only in the folders above them. Within each, results come
//! shallowest first, then in index order.

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
    /// Indexes into `paths`, shallowest first, then in byte order.
    ranked: Vec<usize>,
}

/// A query's results.
#[derive(Debug, PartialEq)]
pub struct Found {
    /// The first matches: name matches before folder-only matches, each
    /// shallowest first, then in index order.
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
        let mut ranked: Vec<usize> = (0..paths.len()).collect();
        // Stable, so paths at one depth keep byte order.
        ranked.sort_by_key(|&at| paths[at].matches('/').count());
        FileSearch {
            paths,
            lowered,
            ranked,
        }
    }

    /// The first `limit` matches for `query`, and the total match count.
    pub fn find(&self, query: &str, limit: usize) -> Found {
        let query = query.to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        let mut named = Vec::new();
        let mut in_folder = Vec::new();
        let mut matched = 0;
        for &at in &self.ranked {
            let lowered = &self.lowered[at];
            if !words.iter().all(|word| lowered.contains(word)) {
                continue;
            }
            matched += 1;
            let name = lowered
                .rfind('/')
                .map_or(lowered.as_str(), |slash| &lowered[slash + 1..]);
            let tier = if words.iter().any(|word| name.contains(word)) {
                &mut named
            } else {
                &mut in_folder
            };
            if tier.len() < limit {
                tier.push(at);
            }
        }
        let files = named
            .into_iter()
            .chain(in_folder)
            .take(limit)
            .map(|at| self.marked(&self.paths[at]))
            .collect();
        Found { files, matched }
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
