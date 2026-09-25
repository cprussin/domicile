//! What the file index leaves out of a home.
//!
//! The index is the whole home at every depth — see
//! `domicile_host::home_walk` — and that is more than a launcher wants on a
//! home with a `~/Library` of mail, or a `~/Projects` of checkouts whose
//! `target/` directories are most of the disk. So what goes in is the desk's
//! to say, here, as globs over paths named relative to the home.

use globset::{Glob, GlobBuilder, GlobMatcher};
use serde::Deserialize;

/// What the file index is built from.
///
/// Compared, which is what `PartialEq` is for: a reload asks what moved
/// between two configs, and what the index omits is one of the answers — see
/// the compositor's `Restatement`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FilesConfig {
    pub omit: Omit,
}

/// The paths the file index leaves out, and everything under them.
///
/// **GITIGNORE'S RULES, WHICH ARE THE ONES ANYBODY WRITING THIS HAS MET.**
/// Each pattern is a glob over a path relative to the home; a `*` stops at a
/// `/` and a `**` does not; a pattern that starts with `!` takes a path back;
/// and the last pattern to match a path decides it. An omitted directory is
/// not walked, so nothing under it can be taken back — which is also what
/// makes this worth having on a home with a `~/Library` in it.
///
/// **SAYING NOTHING OMITS WHAT IS HIDDEN**, at every depth: `**/.*`. A list
/// that is stated replaces that rather than adding to it, so a desk that wants
/// its dotfiles offered can have them.
#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "Vec<String>")]
pub struct Omit {
    /// As written, for [`PartialEq`]: two lists that say the same thing in
    /// different words are two configs, and a reload between them costs one
    /// walk.
    written: Vec<String>,
    rules: Vec<Rule>,
}

/// One pattern, compiled.
#[derive(Debug, Clone)]
struct Rule {
    /// Whether this pattern takes paths back rather than leaving them out.
    keeps: bool,
    glob: GlobMatcher,
}

impl Omit {
    /// Whether `path`, named relative to the home, is left out of the index.
    ///
    /// Only `path` itself: whether it is under something omitted is the
    /// caller's to know — a walk never reaches it, and a watch has to ask of
    /// each of its ancestors.
    pub fn omits(&self, path: &str) -> bool {
        self.rules
            .iter()
            .rev()
            .find(|rule| rule.glob.is_match(path))
            .is_some_and(|rule| !rule.keeps)
    }
}

impl Default for Omit {
    fn default() -> Self {
        Omit::try_from(vec!["**/.*".to_string()]).expect("the default pattern is a glob")
    }
}

impl PartialEq for Omit {
    fn eq(&self, other: &Self) -> bool {
        self.written == other.written
    }
}

impl Eq for Omit {}

impl TryFrom<Vec<String>> for Omit {
    type Error = globset::Error;

    fn try_from(written: Vec<String>) -> Result<Self, Self::Error> {
        let rules = written
            .iter()
            .map(|pattern| {
                let (keeps, glob) = match pattern.strip_prefix('!') {
                    Some(glob) => (true, glob),
                    None => (false, pattern.as_str()),
                };
                Ok(Rule {
                    keeps,
                    glob: compiled(glob)?.compile_matcher(),
                })
            })
            .collect::<Result<_, globset::Error>>()?;
        Ok(Omit { written, rules })
    }
}

/// `pattern` as a glob whose `*` stops at a `/`, which is what makes `*/*`
/// mean two deep rather than two deep or more.
fn compiled(pattern: &str) -> Result<Glob, globset::Error> {
    GlobBuilder::new(pattern).literal_separator(true).build()
}
