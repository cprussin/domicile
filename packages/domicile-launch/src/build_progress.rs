//! Parses the shell builder's stdout and renders it as a progress bar.
//!
//! The builder writes one JSON line per step, ending with `built` or `failed`.
//! Other lines are build log, kept to show if the build fails.

use std::path::PathBuf;

use serde::Deserialize;

use crate::shell_path::Shell;

/// A build step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Resolving,
    Installing(Vec<String>),
    Bundling,
}

/// One parsed line of the builder's stdout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Heard {
    Step(Step),
    /// The built module and the directory it is served from.
    Built(Shell),
    /// A config module was evaluated to this JSON file.
    Evaluated(PathBuf),
    /// The build failed, with the builder's message.
    Failed(String),
    /// A build log line.
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

/// Parses one line of builder output.
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

/// Renders `step` as a terminal progress line.
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
