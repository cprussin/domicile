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
    /// Nobody named one and there is nothing at the path that was looked in.
    Absent(PathBuf),
    /// Nobody named one and there is no home directory to look under.
    Nowhere,
}

impl ConfigFile {
    /// The path to hand the compositor, or nothing for the defaults.
    pub fn path(&self) -> Option<&Path> {
        match self {
            Self::Named(path) | Self::Found(path) => Some(path),
            Self::Absent(_) | Self::Nowhere => None,
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
            Self::Absent(path) => write!(
                out,
                "none -- no {} -- so the compositor's defaults",
                path.display()
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
/// `exists` is asked exactly once, about the default, because that is the one
/// path nobody typed.
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
                let path = home.join(DIRECTORY).join(FILE);
                match exists(&path) {
                    true => ConfigFile::Found(path),
                    false => ConfigFile::Absent(path),
                }
            }
        },
    }
}

/// The directory a config lives in, under the config home.
const DIRECTORY: &str = "domicile";

/// The file itself. TOML, which is what `domicile-config` parses.
const FILE: &str = "domicile.toml";

/// Where this user's configuration is kept.
///
/// `XDG_CONFIG_HOME` when it is set to an absolute path, and `~/.config`
/// otherwise — which is the spec's own rule rather than a kindness. A relative
/// value resolves against whatever directory the desktop happened to be
/// started from, so honouring one would make the config a desk reads depend on
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
