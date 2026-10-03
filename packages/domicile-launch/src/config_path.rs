//! Where the compositor's config file is, when the command line did not say.
//!
//! `~/.config/domicile/domicile.toml`, and `$XDG_CONFIG_HOME/domicile/` when
//! that is set. A person types `domicile <shell>` and their monitors are
//! already written down; nothing has to be typed twice for a desk that is
//! configured once.
//!
//! **THIS IS THE ONLY PLACE A PATH IS GUESSED, AND IT IS DELIBERATELY NOT THE
//! COMPOSITOR.** `arguments.rs` states the rule the compositor keeps: every
//! value is given, nothing is read from the environment, nothing has a default
//! location — because the compositor is started by a *program*, and a program
//! that meant to say something can say it. That rule is untouched. What runs
//! the compositor is `domicile`, which is started by a *person*, and the
//! answer worked out here is written onto the command line it builds. So the
//! compositor is still handed one path or none, chosen by something that can
//! be asked why.
//!
//! The cost of a default is that a desk can come up wearing a file nobody
//! meant, and that is paid for by [`ConfigFile`] naming which of the four
//! answers it is — including the two that are no file, one of which names the
//! path it did not find. A run says it out loud before it starts anything.

use std::path::{Path, PathBuf};

/// Which config file a run has, and how it got it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigFile {
    /// `--config` named it. Handed on without being looked for.
    Named(PathBuf),
    /// Nobody named one and there is a file where a config lives.
    Found(PathBuf),
    /// Nobody named one and there is none in the directory that was looked in.
    Absent(PathBuf),
    /// Nobody named one and there is more than one where a config lives.
    Several(Vec<PathBuf>),
    /// Nobody named one and there is no home directory to look under.
    Nowhere,
}

impl ConfigFile {
    /// The path to hand the compositor, or nothing for the defaults.
    pub fn path(&self) -> Option<&Path> {
        match self {
            Self::Named(path) | Self::Found(path) => Some(path),
            Self::Absent(_) | Self::Several(_) | Self::Nowhere => None,
        }
    }
}

impl std::fmt::Display for ConfigFile {
    /// What the run prints about its own config, in the middle of the sentence
    /// `config: {}`.
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Named(path) => write!(out, "{}, because --config names it", path.display()),
            Self::Found(path) => write!(out, "{}, found where a config lives", path.display()),
            Self::Absent(directory) => write!(
                out,
                "none -- no domicile.{{{}}} in {} -- so the compositor's defaults",
                EXTENSIONS.join(","),
                directory.display()
            ),
            Self::Several(paths) => write!(
                out,
                "more than one: {} -- remove all but one",
                paths
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Self::Nowhere => write!(
                out,
                "none -- neither XDG_CONFIG_HOME nor HOME is set, so there is \
                 nowhere to look -- so the compositor's defaults"
            ),
        }
    }
}

/// Work out which config file this run has.
///
/// `flag` is `--config`, and it wins without being looked for: a path somebody
/// typed is one they meant, and the compositor's complaint about a file it
/// could not read names that file — where a check here would only say the same
/// thing earlier and from a process that is not the one reading it.
///
/// `exists` is asked only about the defaults, one per extension, because those
/// are the paths nobody typed.
pub fn config_file(
    flag: Option<&Path>,
    env: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> ConfigFile {
    match flag {
        Some(path) => ConfigFile::Named(path.to_path_buf()),
        None => match config_home(env) {
            None => ConfigFile::Nowhere,
            Some(home) => {
                let directory = home.join(DIRECTORY);
                let found: Vec<PathBuf> = EXTENSIONS
                    .iter()
                    .map(|extension| directory.join(format!("{FILE}.{extension}")))
                    .filter(|path| exists(path))
                    .collect();
                match found.as_slice() {
                    [] => ConfigFile::Absent(directory),
                    [one] => ConfigFile::Found(one.clone()),
                    _ => ConfigFile::Several(found),
                }
            }
        },
    }
}

/// The directory a config lives in, under the config home.
const DIRECTORY: &str = "domicile";

/// The file itself, without the extension that says what it is written in.
const FILE: &str = "domicile";

/// What a config may be written as, in the order they are listed: a module,
/// which is evaluated, or the JSON or TOML the compositor reads.
const EXTENSIONS: [&str; 6] = ["ts", "tsx", "js", "mjs", "json", "toml"];

/// Whether the config at `path` is a module to evaluate rather than a file
/// the compositor reads.
pub fn is_module(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "js" | "mjs")
    )
}

/// Where this user's configuration is kept.
///
/// `XDG_CONFIG_HOME` when it is set to an absolute path, and `~/.config`
/// otherwise — which is the spec's own rule rather than a kindness. A relative
/// value resolves against whatever directory the desktop happened to be
/// started from, so honoring one would make the config a desk reads depend on
/// where its launcher was standing.
fn config_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let absolute = |value: String| {
        let path = PathBuf::from(value);
        path.is_absolute().then_some(path)
    };
    env("XDG_CONFIG_HOME").and_then(absolute).or_else(|| {
        env("HOME")
            .and_then(absolute)
            .map(|home| home.join(".config"))
    })
}
