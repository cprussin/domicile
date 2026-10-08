//! A `FileChooser` portal filter as the extensions the shell's picker matches.
//!
//! The portal sends each filter as patterns: a glob (`*.png`, often written
//! `*.[pP][nN][gG]`) or a MIME type (`image/png`, `image/*`). A MIME type
//! becomes its extensions through shared-mime-info's `globs2`. See
//! `docs/PORTALS.md`.

use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;

/// A portal pattern's type for a glob.
const GLOB: u32 = 0;

/// A portal pattern's type for a MIME type.
const MIME_TYPE: u32 = 1;

/// The extensions a filter's `patterns` accept.
///
/// `Some(vec![])` accepts any file (`*`). `None` is a filter the picker cannot
/// match, such as `Makefile`: no pattern names an extension.
pub fn extensions(patterns: &[(u32, String)], types: &MimeTypes) -> Option<Vec<String>> {
    let mut named: Vec<String> = Vec::new();
    for (kind, pattern) in patterns {
        let found = match *kind {
            GLOB if pattern == "*" => return Some(Vec::new()),
            GLOB => glob_extension(pattern).into_iter().collect(),
            MIME_TYPE => types.extensions_of(pattern),
            _ => Vec::new(),
        };
        for extension in found {
            if !named.contains(&extension) {
                named.push(extension);
            }
        }
    }
    (!named.is_empty()).then_some(named)
}

/// The `*.ext` globs shared-mime-info lists per MIME type.
#[derive(Debug, Default)]
pub struct MimeTypes {
    extensions: BTreeMap<String, Vec<String>>,
}

impl MimeTypes {
    /// Reads `mime/globs2` from each data directory. A directory without one
    /// adds nothing; any other read error is returned.
    pub fn read(data_dirs: &[PathBuf]) -> io::Result<Self> {
        let mut types = MimeTypes::default();
        for dir in data_dirs {
            match std::fs::read_to_string(dir.join("mime/globs2")) {
                Ok(globs2) => types.add(&globs2),
                Err(why) if why.kind() == io::ErrorKind::NotFound => {}
                Err(why) => return Err(why),
            }
        }
        Ok(types)
    }

    /// Reads one `globs2` file: `weight:type:glob[:flags]` per line.
    pub fn parse(globs2: &str) -> Self {
        let mut types = MimeTypes::default();
        types.add(globs2);
        types
    }

    fn add(&mut self, globs2: &str) {
        let entries = globs2
            .lines()
            .filter(|line| !line.starts_with('#'))
            .filter_map(|line| {
                let mut fields = line.split(':').skip(1);
                Some((fields.next()?, glob_extension(fields.next()?)?))
            });
        for (mime_type, extension) in entries {
            let listed = self.extensions.entry(mime_type.to_string()).or_default();
            if !listed.contains(&extension) {
                listed.push(extension);
            }
        }
    }

    /// The extensions of `mime_type`, or of every subtype for `type/*`.
    fn extensions_of(&self, mime_type: &str) -> Vec<String> {
        match mime_type.strip_suffix("/*") {
            Some(major) => self
                .extensions
                .iter()
                .filter(|(listed, _)| listed.split('/').next() == Some(major))
                .flat_map(|(_, extensions)| extensions.iter().cloned())
                .collect(),
            None => self.extensions.get(mime_type).cloned().unwrap_or_default(),
        }
    }
}

/// The lowercase extension a `*.ext` glob names, reading `[pP]` as `p`.
/// `None` for any other glob.
fn glob_extension(glob: &str) -> Option<String> {
    let mut extension = String::new();
    let mut rest = glob.strip_prefix("*.")?.chars();
    while let Some(next) = rest.next() {
        match next {
            '[' => {
                let class: String = rest.by_ref().take_while(|&c| c != ']').collect();
                let mut letters = class.chars().map(|c| c.to_ascii_lowercase());
                let first = letters.next()?;
                if !letters.all(|letter| letter == first) {
                    return None;
                }
                extension.push(first);
            }
            '*' | '?' | ']' => return None,
            letter => extension.push(letter.to_ascii_lowercase()),
        }
    }
    (!extension.is_empty()).then_some(extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glob(pattern: &str) -> (u32, String) {
        (GLOB, pattern.into())
    }

    fn mime(pattern: &str) -> (u32, String) {
        (MIME_TYPE, pattern.into())
    }

    fn types() -> MimeTypes {
        MimeTypes::parse(
            "# comment\n\
             50:image/png:*.png\n\
             50:image/jpeg:*.jpg\n\
             50:image/jpeg:*.jpeg\n\
             50:text/x-makefile:Makefile\n\
             50:text/plain:*.txt:cs\n",
        )
    }

    #[test]
    fn a_glob_names_its_extension() {
        assert_eq!(
            extensions(&[glob("*.png"), glob("*.tar.gz")], &MimeTypes::default()),
            Some(vec!["png".to_string(), "tar.gz".to_string()])
        );
    }

    #[test]
    fn a_case_insensitive_glob_names_its_extension_once() {
        // Chromium and Electron write each letter as a bracket pair.
        assert_eq!(
            extensions(
                &[glob("*.[pP][nN][gG]"), glob("*.PNG")],
                &MimeTypes::default()
            ),
            Some(vec!["png".to_string()])
        );
    }

    #[test]
    fn a_star_accepts_any_file() {
        assert_eq!(
            extensions(&[glob("*.png"), glob("*")], &MimeTypes::default()),
            Some(vec![])
        );
    }

    #[test]
    fn a_mime_type_names_the_extensions_shared_mime_info_lists() {
        assert_eq!(
            extensions(&[mime("image/jpeg"), mime("text/plain")], &types()),
            Some(vec![
                "jpg".to_string(),
                "jpeg".to_string(),
                "txt".to_string()
            ])
        );
    }

    #[test]
    fn a_wildcard_mime_type_names_every_subtype() {
        assert_eq!(
            extensions(&[mime("image/*")], &types()),
            Some(vec![
                "jpg".to_string(),
                "jpeg".to_string(),
                "png".to_string()
            ])
        );
    }

    #[test]
    fn a_filter_with_no_extension_cannot_be_matched() {
        assert_eq!(
            extensions(
                &[glob("Makefile"), mime("text/x-makefile"), mime("x/unknown")],
                &types()
            ),
            None
        );
    }

    #[test]
    fn data_directories_without_globs_add_nothing() {
        let with = std::env::temp_dir().join(format!("domicile-mime-{}", std::process::id()));
        std::fs::create_dir_all(with.join("mime")).expect("a temporary directory");
        std::fs::write(with.join("mime/globs2"), "50:image/png:*.png\n").expect("globs2");

        let read = MimeTypes::read(&[PathBuf::from("/nonexistent"), with.clone()]).expect("read");
        std::fs::remove_dir_all(&with).expect("cleaned up");

        assert_eq!(
            extensions(&[mime("image/png")], &read),
            Some(vec!["png".to_string()])
        );
    }
}
