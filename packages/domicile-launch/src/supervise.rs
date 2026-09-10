//! Two processes, in the one order they can be started in.
//!
//! The engine first: it serves the shell itself over `domicile://` and creates
//! the broker socket. Then the compositor, which connects to that socket as a
//! producer. The compositor's own control socket is named to the engine up
//! front and dialled later, when the page asks for `navigator.domicile`, so
//! nothing here has to wait for it.
//!
//! There were three, and the first was a bridge serving the page over a
//! loopback HTTP port. The fork serves it, so that process and the wait for
//! the URL it printed are both gone.
//!
//! Everything decidable is decided elsewhere: `spawn` says what each process
//! is started with, `platform` which platform, `components` where each lives,
//! `milestones` what a run has to reach and what to say when it does not.
//! What is left here is starting them, watching them, and making sure nothing
//! outlives the run.

use std::process::{Child, Command, ExitStatus};
use std::time::Duration;

use crate::spawn::Spawn;

/// How often the components are asked whether they are still components.
///
/// The same number the broker socket was polled at, and for the same reason:
/// there is nothing a parent can wait on that covers "either of these two,
/// whichever is first" without a signal handler, and a tenth of a second is
/// below what anyone reads as a delay.
pub const ASK_EVERY: Duration = Duration::from_millis(100);

/// A run that could not be started, and what went wrong.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("could not start the {what} at {}: {source}", .program.display())]
    Start {
        what: &'static str,
        program: std::path::PathBuf,
        source: std::io::Error,
    },
}

/// A component that is no longer running.
///
/// `how` is the status as the shell would say it — `exit status: 1`, `signal:
/// 11 (SIGSEGV)` — rather than a number, because a desktop killed by a signal
/// and one that returned 11 are different failures and a bare `11` is both.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the {what} exited ({how})")]
pub struct Exit {
    pub what: &'static str,
    pub how: String,
}

impl Exit {
    /// What to say when this happens to a desktop that was already up.
    ///
    /// Either component going takes the desktop with it — the engine holds the
    /// window everything is drawn in, the compositor holds the display every
    /// client is connected to — so the second half of the sentence is the same
    /// whichever one it was.
    pub fn ended_the_desktop(&self) -> String {
        format!("{self}, so the desktop is over.")
    }
}

/// Children killed when the run ends, however it ends.
///
/// A desktop that exits leaving an engine behind holds the Wayland display its
/// replacement wants, and the second one fails about a socket rather than
/// about the first still running.
pub struct Running(Vec<(&'static str, Child)>);

impl Drop for Running {
    fn drop(&mut self) {
        for (_, child) in &mut self.0 {
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
        self.0.push((what, child));
        Ok(())
    }

    /// The first component that has stopped being one, if any has.
    ///
    /// Asked rather than waited on: this is what a startup wait consults
    /// between polls, and it must answer "not yet" without blocking.
    ///
    /// A `wait` that fails on a child this process started and holds is an
    /// invariant violation rather than a condition — there is no state left to
    /// report from — so it takes the run down here rather than being folded
    /// into an error nobody could act on.
    pub fn exited(&mut self) -> Option<Exit> {
        self.0.iter_mut().find_map(|(what, child)| {
            child
                .try_wait()
                .expect("a child this process started can be waited on")
                .map(|status| exit(what, status))
        })
    }

    /// Block until one of them exits, and say which.
    ///
    /// Whichever one, rather than the last started. Waiting on the compositor
    /// was what made an engine that died a desktop that hung: the window was
    /// gone, the compositor was still up, and the run sat in `wait` with
    /// nothing on the terminal.
    pub fn until_one_exits(&mut self) -> Exit {
        loop {
            match self.exited() {
                Some(exit) => return exit,
                None => std::thread::sleep(ASK_EVERY),
            }
        }
    }
}

impl Default for Running {
    fn default() -> Self {
        Running::new()
    }
}

fn exit(what: &'static str, status: ExitStatus) -> Exit {
    Exit {
        how: status.to_string(),
        what,
    }
}

fn command(spawn: &Spawn) -> Command {
    let mut command = Command::new(&spawn.program);
    command.args(&spawn.args);
    for (name, value) in &spawn.env {
        command.env(name, value);
    }
    command
}
