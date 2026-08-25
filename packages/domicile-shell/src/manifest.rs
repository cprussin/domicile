//! What a shell package declares about itself.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::ShellError;

/// The file a shell package declares itself in, at the root of the package.
pub const MANIFEST_NAME: &str = "domicile.shell.json";

/// A shell package's own account of itself.
///
/// This is the contract between Domicile and a shell, and it is checked before
/// anything is started: a shell whose `protocol` is not the compositor's is
/// refused here, with a file to look at, rather than at a handshake a loaded
/// page has to reach first.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShellManifest {
    /// What the shell calls itself, and what `ShellRef::Name` looks up.
    pub name: String,
    /// One line, for a compositor listing what is installed.
    pub description: String,
    /// The host protocol version this build speaks.
    pub protocol: u32,
    /// The program Domicile runs, relative to the package directory.
    pub entry: PathBuf,
}

impl ShellManifest {
    /// Parse a manifest, with `path` naming it in any error.
    ///
    /// `path` is passed rather than derived because the commonest reader of
    /// these errors is a shell author looking at a compositor's log, where
    /// "invalid manifest" without a file is a hunt through everything
    /// installed.
    pub fn parse(text: &str, path: &Path) -> Result<ShellManifest, ShellError> {
        let manifest: ShellManifest =
            serde_json::from_str(text).map_err(|e| ShellError::Malformed {
                path: path.display().to_string(),
                message: e.to_string(),
            })?;
        manifest.validate(path)?;
        Ok(manifest)
    }

    /// Read the manifest out of a shell package directory.
    pub fn load(directory: &Path) -> Result<ShellManifest, ShellError> {
        let path = directory.join(MANIFEST_NAME);
        let text = std::fs::read_to_string(&path).map_err(|e| ShellError::Unreadable {
            path: path.display().to_string(),
            kind: e.kind(),
            message: e.to_string(),
        })?;
        ShellManifest::parse(&text, &path)
    }

    /// What the deserializer cannot say: that the two paths in here are safe to
    /// join onto a directory and run.
    ///
    /// A manifest is the least trustworthy thing in starting a shell — trying
    /// one out is unpacking a directory someone else built — and both fields
    /// below are used as paths. Neither is checked anywhere later: `name` is
    /// joined onto a search-path entry and `entry` onto the package directory,
    /// and a `..` in either escapes the directory it was supposed to name.
    fn validate(&self, path: &Path) -> Result<(), ShellError> {
        let invalid = |message: String| ShellError::Invalid {
            path: path.display().to_string(),
            message,
        };
        if !is_bare_name(&self.name) {
            Err(invalid(format!(
                "name must be a single path segment with no separators, got {:?}",
                self.name
            )))
        } else if !names_a_file_inside(&self.entry) {
            Err(invalid(format!(
                "entry must be a relative path to a file inside the package, got {}",
                self.entry.display()
            )))
        } else {
            Ok(())
        }
    }
}

/// Whether a string is usable as one directory name.
///
/// `Path::components` normalises away a bare `.` and collapses repeated
/// separators, so asking for exactly one `Normal` component rejects the empty
/// string, `.`, `..`, anything absolute, and anything with a separator in it —
/// without a list of characters to keep in step with the platform.
fn is_bare_name(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::Normal(_)), None)
    )
}

/// Whether a relative path names a file, and one that is *lexically* inside the
/// directory it will be joined onto.
///
/// `CurDir` is allowed because `./main.js` is an ordinary way to write a path
/// in the package root, and refusing it told the author it was not a relative
/// path inside the package — which it is. What is refused is a `..` or a root,
/// so `a/../b` goes too: it is inside the package but says so the long way
/// round, and no shell needs to write that.
///
/// Lexical rather than canonicalised, deliberately: this runs before anything
/// is opened, so a manifest naming a path that does not exist yet is still
/// readable. The limit of that is worth being plain about — a `Normal`
/// component can be a symlink pointing anywhere, so this is not containment and
/// must not be relied on as though it were. What it buys is that a manifest
/// cannot *silently* name something outside the directory an operator thinks
/// they installed.
fn names_a_file_inside(path: &Path) -> bool {
    use std::path::Component;
    // Nothing that climbs or roots, *and* at least one named component. The
    // second half is not pedantry: `""`, `"."` and `"./"` pass the first
    // vacuously — `Path::components` yields nothing for the first and only
    // `CurDir` for the others — and joining any of them onto the package
    // directory gives the directory back. Electron handed a directory reads
    // that directory's `package.json` `main`, which is the thing this manifest
    // exists to replace.
    path.components()
        .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
        && path
            .components()
            .any(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{
      "name": "manganese",
      "description": "a tab rail and a stage",
      "protocol": 14,
      "entry": ".vite/build/main.js"
    }"#;

    fn parse(text: &str) -> Result<ShellManifest, ShellError> {
        ShellManifest::parse(text, Path::new("/shells/x/domicile.shell.json"))
    }

    #[test]
    fn reads_every_field() {
        assert_eq!(
            parse(GOOD).unwrap(),
            ShellManifest {
                name: "manganese".into(),
                description: "a tab rail and a stage".into(),
                protocol: 14,
                entry: PathBuf::from(".vite/build/main.js"),
            }
        );
    }

    #[test]
    fn a_missing_field_names_itself_and_the_file() {
        // The whole point of naming the file: a shell author reads this from a
        // compositor's log, with no idea which of the installed packages it is
        // about.
        let err = parse(r#"{"name": "x", "description": "y", "protocol": 14}"#).unwrap_err();
        let ShellError::Malformed { path, message } = err else {
            panic!("expected Malformed, got {err:?}");
        };
        assert_eq!(path, "/shells/x/domicile.shell.json");
        assert!(message.contains("entry"), "{message}");
    }

    #[test]
    fn an_unknown_field_is_refused() {
        // Rather than ignored. A key that does nothing is nearly always a
        // misspelling of one that does, and a manifest is small enough that a
        // typo in it is otherwise invisible: the shell simply behaves as though
        // the line were not there.
        let err =
            parse(r#"{"name":"x","description":"y","protocol":14,"entry":"m.js","enrty":"m.js"}"#)
                .unwrap_err();
        assert!(matches!(err, ShellError::Malformed { .. }), "{err:?}");
    }

    #[test]
    fn a_name_that_is_a_path_is_refused() {
        // `name` is what `ShellRef::Name` looks up, so it is joined onto a
        // search-path directory. A name carrying a separator would resolve
        // outside the directory it was found in — and the manifest declaring it
        // is the least trustworthy thing in the transaction, since installing a
        // shell is what a user does to try one out.
        for bad in ["../escape", "a/b", "/absolute"] {
            let text =
                format!(r#"{{"name":"{bad}","description":"y","protocol":14,"entry":"m.js"}}"#);
            let err = parse(&text).unwrap_err();
            assert!(
                matches!(err, ShellError::Invalid { .. }),
                "{bad:?} was accepted: {err:?}"
            );
        }
    }

    #[test]
    fn an_empty_name_is_refused() {
        let err =
            parse(r#"{"name":"","description":"y","protocol":14,"entry":"m.js"}"#).unwrap_err();
        assert!(matches!(err, ShellError::Invalid { .. }), "{err:?}");
    }

    #[test]
    fn an_entry_that_names_no_file_is_refused() {
        // `""`, `"."` and `"./"` all have no `Normal` component, so joining one
        // onto the package directory yields the *directory* — and Electron
        // given a directory reads that directory's `package.json` `main`. That
        // is exactly the "the manifest is decorative, `package.json` really
        // decides" failure this whole change exists to end, and the guide tells
        // shell authors to ship a `package.json` in there.
        for bad in ["", ".", "./"] {
            let text = format!(r#"{{"name":"x","description":"y","protocol":14,"entry":"{bad}"}}"#);
            let err = parse(&text).unwrap_err();
            assert!(
                matches!(err, ShellError::Invalid { .. }),
                "{bad:?} was accepted: {err:?}"
            );
        }
    }

    #[test]
    fn an_entry_that_leaves_the_package_is_refused() {
        // Same reason, one step further along: `entry` is what gets *executed*,
        // and it is resolved against the package directory. A manifest that can
        // name `/usr/bin/anything` — or climb out with `..` — turns installing a
        // shell into running an arbitrary program.
        for bad in ["../../bin/sh", "/bin/sh", "sub/../../out.js"] {
            let text = format!(r#"{{"name":"x","description":"y","protocol":14,"entry":"{bad}"}}"#);
            let err = parse(&text).unwrap_err();
            assert!(
                matches!(err, ShellError::Invalid { .. }),
                "{bad:?} was accepted: {err:?}"
            );
        }
    }

    #[test]
    fn the_ordinary_shapes_of_an_entry_are_allowed() {
        // The cases the check above must not catch, which is the half a test
        // for the rejections cannot show. `./main.js` in particular was
        // refused, with a message saying it was not a relative path inside the
        // package — which it is.
        for good in [
            "./main.js",
            "main.js",
            "sub/dir/main.js",
            ".vite/build/main.js",
            "a.b/main.js",
        ] {
            let text =
                format!(r#"{{"name":"x","description":"y","protocol":14,"entry":"{good}"}}"#);
            assert!(parse(&text).is_ok(), "{good:?} was refused");
        }
    }

    #[test]
    fn syntax_errors_say_where() {
        let err = parse("{not json").unwrap_err();
        let ShellError::Malformed { path, message } = err else {
            panic!("expected Malformed, got {err:?}");
        };
        assert_eq!(path, "/shells/x/domicile.shell.json");
        assert!(message.contains("line"), "{message}");
    }

    #[test]
    fn load_reads_the_manifest_out_of_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MANIFEST_NAME), GOOD).unwrap();
        assert_eq!(ShellManifest::load(dir.path()).unwrap().name, "manganese");
    }

    #[test]
    fn load_says_which_file_was_missing() {
        let dir = tempfile::tempdir().unwrap();
        let err = ShellManifest::load(dir.path()).unwrap_err();
        let ShellError::Unreadable { path, .. } = err else {
            panic!("expected Unreadable, got {err:?}");
        };
        assert!(path.ends_with(MANIFEST_NAME), "{path}");
    }
}
