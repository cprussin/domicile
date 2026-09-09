//! Three processes, in the one order they can be started in.
//!
//! The bridge first, because the engine needs a URL and a page cannot open a
//! unix socket — `file:` has no origin to derive one from. Then the engine, on
//! that page, which creates the broker socket. Then the compositor, which
//! connects to that socket as a producer. So the page is up, and talking,
//! before the compositor exists.
//!
//! Everything decidable is decided elsewhere: `spawn` says what each process
//! is started with, `platform` which platform, `components` where each lives.
//! What is left here is starting them, waiting for two signals, and making
//! sure nothing outlives the run.

use std::io::{BufRead as _, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::cli::serving_url;
use crate::spawn::Spawn;

/// A run that could not be started, and what went wrong.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("could not start the {what} at {}: {source}", .program.display())]
    Start {
        what: &'static str,
        program: std::path::PathBuf,
        source: std::io::Error,
    },
    #[error("the bridge never said where it was serving. It said:\n{said}")]
    NoUrl { said: String },
    #[error("the engine never opened its broker socket at {}", .0.display())]
    NoBroker(std::path::PathBuf),
}

/// Children killed when the run ends, however it ends.
///
/// A desktop that exits leaving an engine behind holds the Wayland display its
/// replacement wants, and the second one fails about a socket rather than
/// about the first still running.
pub struct Running(Vec<Child>);

impl Drop for Running {
    fn drop(&mut self) {
        for child in &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Running {
    pub fn new() -> Self {
        Running(Vec::new())
    }

    /// Start one, with its stdout going wherever the caller's does.
    pub fn start(&mut self, what: &'static str, spawn: &Spawn) -> Result<(), RunError> {
        let child = command(spawn).spawn().map_err(|source| RunError::Start {
            program: spawn.program.clone(),
            source,
            what,
        })?;
        self.0.push(child);
        Ok(())
    }

    /// Start the bridge and wait for it to say where it is serving.
    ///
    /// Its stdout is read rather than tailed from a file: the one line that is
    /// an interface arrives on it, and the rest is the bridge's own log.
    pub fn start_bridge(&mut self, spawn: &Spawn) -> Result<String, RunError> {
        let mut child = command(spawn)
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|source| RunError::Start {
                program: spawn.program.clone(),
                source,
                what: "bridge",
            })?;
        let stdout = child.stdout.take().expect("stdout was piped");
        self.0.push(child);

        let mut said = String::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(url) = serving_url(&line) {
                return Ok(url.to_string());
            }
            said.push_str(&line);
            said.push('\n');
        }
        Err(RunError::NoUrl { said })
    }

    /// Wait for the last child started, which is the one the desktop is.
    pub fn wait_for_the_desktop(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.0.last_mut().expect("a desktop was started").wait()
    }
}

impl Default for Running {
    fn default() -> Self {
        Running::new()
    }
}

/// Wait for the engine to open the socket the compositor submits through.
///
/// Polled rather than watched: the engine creates it when it is ready, and
/// there is no notification a parent can wait on that is simpler than asking.
pub fn wait_for_broker(broker: &Path, patience: Duration) -> Result<(), RunError> {
    let until = Instant::now() + patience;
    while Instant::now() < until {
        if broker.exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(RunError::NoBroker(broker.to_path_buf()))
}

fn command(spawn: &Spawn) -> Command {
    let mut command = Command::new(&spawn.program);
    command.args(&spawn.args);
    for (name, value) in &spawn.env {
        command.env(name, value);
    }
    command
}
