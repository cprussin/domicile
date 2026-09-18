//! Two processes, in the one order they can be started in.
//!
//! The engine first: it serves the shell itself over `domicile://` and creates
//! the broker socket. Then the compositor, which connects to that socket as a
//! producer. The compositor's own control socket is named to the engine up
//! front and dialed later, when the page asks for `navigator.domicile`, so
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

use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
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

/// How long a component gets to put the machine down tidily before it is
/// taken down.
///
/// NOT LONG ENOUGH TO MATTER FOR THE CONSOLE, AND IT DOES NOT NEED TO BE.
/// The console is not handed back by the engine on its way out under either
/// signal: Chromium's `SIGTERM` handler ends in
/// `TerminateCurrentProcessImmediately`, which is `_exit`, so no destructor
/// runs on the term path any more than on the kill path. What gives the tty
/// back is logind, which restores `VT_AUTO`, the keyboard mode and `KD_TEXT`
/// and revokes every device it handed out when the controller's bus name
/// drops (`session_drop_controller`, systemd `src/login/logind-session.c`) --
/// and a closed socket is a closed socket whether it was closed by `_exit` or
/// by `SIGKILL`. So this grace is not racing the console.
///
/// It is still asked to stop rather than stopped, for the profile Chromium
/// writes on the way out. Lengthening it would not make a tty safer; what
/// makes a tty safe is that nothing gets orphaned while still holding the
/// console, which is [`crate::milestones::reach`]'s business.
const LAST_WORDS: Duration = Duration::from_secs(3);

/// Children killed when the run ends, however it ends.
///
/// A desktop that exits leaving an engine behind holds the Wayland display its
/// replacement wants, and the second one fails about a socket rather than
/// about the first still running.
pub struct Running(Vec<(&'static str, Child)>);

impl Drop for Running {
    fn drop(&mut self) {
        for (_, child) in &mut self.0 {
            end_the_group(child);
        }
    }
}

/// Stop a component and everything it started.
///
/// THE ENGINE IS NOT ONE PROCESS, which is what made this necessary.
/// Chromium forks a GPU process, a zygote and more, and `Child::kill` reaches
/// the browser alone: on 2026-09-15 the browser took `SIGSEGV` two hundred
/// milliseconds into a tty run and a sibling was still logging eight seconds
/// later, holding DRM master on the card. The console was not recoverable and
/// nothing said why, because from here the component had exited.
///
/// So each one leads a process group and the group is what is signalled.
/// `SIGTERM` first, because the engine has a console to hand back; `SIGKILL`
/// after `LAST_WORDS`, because a component that will not go is worse than one
/// that did not get to say goodbye.
///
/// Signalling the group by the leader's pid stays right after the leader has
/// been reaped: a process group outlives its leader as long as it has members,
/// and the members are exactly what this is for.
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

/// `killpg`, with the failure ignored on purpose: the only one reachable here
/// is `ESRCH`, which means the group is already gone, which is the outcome
/// being asked for.
fn signal_group(group: libc::pid_t, signal: libc::c_int) {
    unsafe {
        libc::killpg(group, signal);
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

/// Set by the handler, read by the poll loop. A `static` because a signal
/// handler has no other way to reach the program, and an `AtomicBool` because
/// it is the only thing it is allowed to touch.
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

extern "C" fn note_the_interrupt(_signal: libc::c_int) {
    INTERRUPTED.store(true, Ordering::Relaxed);
}

/// Make Ctrl-C end the run rather than end this process.
///
/// WITHOUT THIS, PUTTING THE COMPONENTS IN THEIR OWN GROUPS WOULD BREAK
/// CTRL-C. The kernel sends `SIGINT` to the terminal's foreground process
/// group, and all three used to be in it, so Ctrl-C reached the engine and the
/// compositor directly and the default action stopped them. They are not in it
/// any more -- that is the point, so that `end_the_group` can reach what they
/// fork -- so the signal now arrives here alone, and the default action would
/// kill this process before `Running::drop` could run. The desktop would be
/// exactly as orphaned as the crash this change is about.
///
/// A flag rather than a teardown in the handler, because a handler may call
/// almost nothing and `kill` is not the half of it. The supervisor already
/// polls at `ASK_EVERY`; this is one more thing for it to notice.
///
/// `SIGTERM` as well as `SIGINT`: a `systemctl stop` and a Ctrl-C are the same
/// request, and a desktop left running by the first is the same wedged console.
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
    // A GROUP OF ITS OWN, so that `end_the_group` can reach what this process
    // goes on to fork. `0` means "a new group led by the child".
    //
    // It also takes the child out of the terminal's foreground group, which is
    // why `catch_interrupts` exists: Ctrl-C used to reach all three because
    // they shared that group, and without a handler here it would now reach
    // this process alone and kill it before any of this ran.
    command.process_group(0);
    command
}
