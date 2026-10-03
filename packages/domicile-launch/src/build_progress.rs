//! What the builder says on its stdout, read, and drawn as a bar.
//!
//! One JSON line per step; `built` or `failed` last. Anything else on the
//! stream is the build's own log — Panda says how long it took — and is kept
//! for a failure to show rather than drawn.

use std::path::PathBuf;

use serde::Deserialize;

use crate::shell_path::Shell;

/// A step a build is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Resolving,
    Installing(Vec<String>),
    Bundling,
}

/// One line of the builder's stdout, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Heard {
    Step(Step),
    /// The module, and the directory it is served out of.
    Built(Shell),
    /// A config module evaluated: the compositor's config, as JSON there.
    Evaluated(PathBuf),
    /// The build failed, in the builder's words.
    Failed(String),
    /// Not a step: the build's own log.
    Log(String),
}

#[derive(Deserialize)]
#[serde(tag = "step", rename_all = "lowercase")]
enum Line {
    Resolving,
    Installing { packages: Vec<String> },
    Bundling,
    Built { root: PathBuf, module: PathBuf },
    Evaluated { config: PathBuf },
    Failed { why: String },
}

/// What `line` says.
pub fn heard(line: &str) -> Heard {
    match serde_json::from_str::<Line>(line) {
        Ok(Line::Resolving) => Heard::Step(Step::Resolving),
        Ok(Line::Installing { packages }) => Heard::Step(Step::Installing(packages)),
        Ok(Line::Bundling) => Heard::Step(Step::Bundling),
        Ok(Line::Built { root, module }) => Heard::Built(Shell { root, module }),
        Ok(Line::Evaluated { config }) => Heard::Evaluated(config),
        Ok(Line::Failed { why }) => Heard::Failed(why),
        Err(_) => Heard::Log(line.to_string()),
    }
}

/// `step` as the line a terminal shows while a shell builds.
pub fn bar(step: &Step) -> String {
    let (done, saying) = match step {
        Step::Resolving => (1, "reading what it imports".to_string()),
        Step::Installing(packages) => (2, format!("installing {}", packages.join(", "))),
        Step::Bundling => (3, "bundling".to_string()),
    };
    format!(
        "[{}{}] building the shell: {saying}",
        "#".repeat(done),
        "-".repeat(3 - done)
    )
}
