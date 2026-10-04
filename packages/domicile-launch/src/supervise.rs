//! Starts, watches and stops the engine and compositor processes.
//!
//! The engine starts first and creates the broker socket. The compositor then
//! connects to it. The engine dials the compositor's control socket later,
//! when the page needs it, so nothing waits on it here.
//!
//! Command lines come from `spawn`. This module makes sure no child outlives
//! the run.

use std::io::{BufRead, BufReader};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::heard::Heard;
use crate::spawn::Spawn;

/// How often to poll the components for exit.
///
/// Waiting on whichever of several children exits first needs a signal
/// handler, so we poll. 100 ms is not a noticeable delay.
pub const ASK_EVERY: Duration = Duration::from_millis(100);

/// A component could not be started.
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
/// `how` is the formatted status, such as `signal: 11 (SIGSEGV)`, so a
/// signal is not confused with an exit code.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the {what} exited ({how})")]
pub struct Exit {
    pub what: &'static str,
    pub how: String,
}

/// Grace period between `SIGTERM` and `SIGKILL`.
///
/// `SIGTERM` lets Chromium save its profile. The console does not depend on
/// it: logind restores the VT when the engine's bus connection closes, however
/// the engine exits.
const LAST_WORDS: Duration = Duration::from_secs(3);

/// Children killed when the run ends, however it ends.
///
/// A leftover engine would hold sockets the next desktop needs.
pub struct Running {
    components: Vec<(&'static str, Child)>,
    listeners: Vec<JoinHandle<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        for (_, child) in &mut self.components {
            end_the_group(child);
        }
        // Join after the groups are gone: a listener's read ends only when
        // every writer to the pipe has exited. Joining, not detaching,
        // ensures the caller sees the last lines of stderr.
        //
        // Ignore a panicked listener. Panicking in `Drop` during an unwind
        // would abort.
        for listener in self.listeners.drain(..) {
            let _ = listener.join();
        }
    }
}

/// Stops a component and everything it started.
///
/// Chromium forks GPU and zygote processes that `Child::kill` would miss. An
/// orphaned one can keep DRM master and lock up the console. So each
/// component leads a process group, which gets `SIGTERM`, then `SIGKILL`
/// after [`LAST_WORDS`].
///
/// The group outlives its leader while it has members, so signaling it by the
/// leader's pid works after the leader is reaped.
fn end_the_group(child: &mut Child) {
    let group = child.id() as libc::pid_t;
    signal_group(group, libc::SIGTERM);

    let deadline = std::time::Instant::now() + LAST_WORDS;
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => break,
            _ => std::thread::sleep(ASK_EVERY),
        }
    }

    signal_group(group, libc::SIGKILL);
    let _ = child.wait();
}

/// Starts one component with the given stderr.
fn started(what: &'static str, spawn: &Spawn, stderr: fn() -> Stdio) -> Result<Child, RunError> {
    command(spawn)
        .stderr(stderr())
        .spawn()
        .map_err(|source| RunError::Start {
            program: spawn.program.clone(),
            source,
            what,
        })
}

/// Copies a component's stderr to ours and into `heard`, for repeating if the
/// run gives up.
///
/// Reads bytes rather than `lines()`, which stops at the first invalid UTF-8.
fn overhear(what: &'static str, stderr: std::process::ChildStderr, heard: &Mutex<Heard>) {
    let mut reader = BufReader::new(stderr);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            // The component exited.
            Ok(0) => return,
            Ok(_) => {
                let said = String::from_utf8_lossy(&line);
                let said = said.trim_end_matches(['\n', '\r']);
                eprintln!("{said}");
                heard
                    .lock()
                    .expect("nothing panics holding what a component said")
                    .line(said);
            }
            // Unrecoverable. Report it; this thread has no caller to return to.
            Err(why) => {
                eprintln!("domicile: lost the rest of what the {what} said: {why}");
                return;
            }
        }
    }
}

/// Calls `killpg`, ignoring failure. The only reachable error is `ESRCH`: the
/// group is already gone.
fn signal_group(group: libc::pid_t, signal: libc::c_int) {
    unsafe {
        libc::killpg(group, signal);
    }
}

impl Running {
    pub fn new() -> Self {
        Running {
            components: Vec::new(),
            listeners: Vec::new(),
        }
    }

    /// Starts a component that inherits our stderr.
    pub fn start(&mut self, what: &'static str, spawn: &Spawn) -> Result<(), RunError> {
        let child = started(what, spawn, Stdio::inherit)?;
        self.components.push((what, child));
        Ok(())
    }

    /// Starts a component, echoing its stderr and keeping a copy in `heard`.
    ///
    /// The copy is repeated if the run gives up; see [`crate::heard`].
    pub fn start_overheard(
        &mut self,
        what: &'static str,
        spawn: &Spawn,
        heard: &Arc<Mutex<Heard>>,
    ) -> Result<(), RunError> {
        let mut child = started(what, spawn, Stdio::piped)?;
        let listening = child.stderr.take().expect("stderr was asked for a pipe");
        let heard = Arc::clone(heard);
        self.listeners.push(std::thread::spawn(move || {
            overhear(what, listening, &heard)
        }));
        self.components.push((what, child));
        Ok(())
    }

    /// Stops the named component's process group and forgets it.
    ///
    /// Used to replace a dead engine, whose GPU and zygote processes may still
    /// hold the card. The entry must be removed, or [`Running::exited`] would
    /// report the old exit forever. An unknown name is a no-op.
    pub fn let_go_of(&mut self, what: &'static str) {
        for (_, child) in self.components.iter_mut().filter(|(held, _)| *held == what) {
            end_the_group(child);
        }
        self.components.retain(|(held, _)| *held != what);
    }

    /// Returns the first component that has exited, without blocking.
    ///
    /// Panics if `try_wait` fails, which cannot happen for our own child.
    pub fn exited(&mut self) -> Option<Exit> {
        self.components.iter_mut().find_map(|(what, child)| {
            child
                .try_wait()
                .expect("a child this process started can be waited on")
                .map(|status| exit(what, status))
        })
    }

    /// Blocks until any component exits or a stop is requested.
    pub fn until_one_exits(&mut self) -> Exit {
        loop {
            if let Some(exit) = self.exited() {
                return exit;
            }
            if interrupted() {
                return Exit {
                    what: "desktop",
                    how: "interrupted".to_string(),
                };
            }
            std::thread::sleep(ASK_EVERY);
        }
    }
}

impl Default for Running {
    fn default() -> Self {
        Running::new()
    }
}

/// Set by the signal handler and read by the poll loop. An atomic is all a
/// signal handler may safely touch.
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

extern "C" fn note_the_interrupt(_signal: libc::c_int) {
    INTERRUPTED.store(true, Ordering::Relaxed);
}

/// Makes `SIGINT` and `SIGTERM` end the run instead of killing this process.
///
/// Components run in their own process groups, so Ctrl-C reaches only this
/// process. Without a handler it would die before `Running::drop` stopped
/// them. The handler only sets a flag, which the poll loop checks.
pub fn catch_interrupts() {
    for signal in [libc::SIGINT, libc::SIGTERM] {
        // SAFETY: `note_the_interrupt` touches one atomic and nothing else,
        // which is what a handler is permitted to do.
        unsafe {
            libc::signal(
                signal,
                note_the_interrupt as *const () as libc::sighandler_t,
            );
        }
    }
}

/// Whether a stop has been asked for since the run began.
pub fn interrupted() -> bool {
    INTERRUPTED.load(Ordering::Relaxed)
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
    // A new process group led by the child, so `end_the_group` reaches its
    // forks. This also removes it from the terminal's foreground group; see
    // `catch_interrupts`.
    command.process_group(0);
    command
}
