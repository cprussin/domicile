//! `domicile ./my-desktop/dist/shell.js` — a desktop, in one command. And
//! `domicile which-shell` — a command for the desktop already running.
//!
//! Everything with a decision in it is a module of `domicile_launch` with
//! tests of its own; this is the part that reads the world and starts things.
//! It is deliberately short, because it is the part nothing can test: no CI
//! runner has a display, and the shell script it replaces was not run by
//! anything either. `scripts/test-the-control-socket.sh` is what covers the
//! wiring below that the unit tests cannot reach.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use domicile_launch::cli::{invocation, Invocation};
use domicile_launch::components::components;
use domicile_launch::control::{answer, Request, Response};
use domicile_launch::control_socket::{
    address, advertised, answer_one, ask, take, Control, PATIENCE as ANSWER_WITHIN, VARIABLE,
};
use domicile_launch::milestones::{reach, Milestone};
use domicile_launch::platform::platform;
use domicile_launch::shell_path::shell_module;
use domicile_launch::spawn::{compositor, engine, Runtime};
use domicile_launch::supervise::{Running, ASK_EVERY};

/// How long each component gets to do the one thing the next one waits on. A
/// debug build on a loaded machine is seconds, not milliseconds.
const PATIENCE: Duration = Duration::from_secs(30);

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(said) => {
            eprintln!("domicile: {said}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<ExitCode, String> {
    match invocation(std::env::args().skip(1)).map_err(|why| why.to_string())? {
        Invocation::Run { shell } => desktop(&shell),
        Invocation::Ask { request } => asked(&request),
    }
}

/// Put one command to the desktop that is already running, and say what it
/// said.
fn asked(request: &Request) -> Result<ExitCode, String> {
    let socket =
        advertised(std::env::var(VARIABLE).ok().as_deref()).map_err(|why| why.to_string())?;
    let answer = ask(&socket, request, ANSWER_WITHIN).map_err(|why| why.to_string())?;
    match answer {
        Response::Shell { module } => {
            println!("{}", module.display());
            Ok(ExitCode::SUCCESS)
        }
        // The desktop refused. It is a desktop of another build, or something
        // else is answering at that path — either way the asker gets the
        // sentence the desktop wrote rather than one invented here.
        Response::Refused { why } => {
            eprintln!("domicile: {why}");
            Ok(ExitCode::FAILURE)
        }
    }
}

/// Run a desktop on `shell` until one of its components stops.
fn desktop(shell: &str) -> Result<ExitCode, String> {
    let env = |name: &str| std::env::var(name).ok();

    let binary = std::env::current_exe().map_err(|why| format!("cannot find myself: {why}"))?;
    let components =
        components(&binary, &env, &|path| path.exists()).map_err(|missing| missing.to_string())?;

    // `DOMICILE_PAGE` names the module, exactly as the argument does — a
    // packaged desktop is a wrapper that types the command line so its user
    // does not have to, and a second spelling of "which shell" would only be
    // a second thing to get wrong.
    let page = shell_module(shell, env("DOMICILE_PAGE").as_deref(), &|path| {
        path.metadata().ok().map(|found| found.is_dir())
    })
    .map_err(|why| why.to_string())?;

    // One directory per run, thrown away with it. The sockets and the engine's
    // profile go in it, so a desktop that exits leaves nothing behind and two
    // running at once do not meet.
    let runtime = tempdir().map_err(|why| format!("no runtime directory: {why}"))?;
    let places = Runtime {
        broker: runtime.join("broker"),
        chrome_socket: runtime.join("chrome.sock"),
        control: address(env("XDG_RUNTIME_DIR").as_deref(), std::process::id()),
        profile: runtime.join("profile"),
        session: runtime.join("session.json"),
    };

    // What was chosen, before anything is started: a failure below is about
    // this shell, and naming it after the failure is too late to be read. The
    // module rather than its directory, because the directory is what this
    // used to print and it agreed with the wrong file as readily as the right
    // one — the whole of the bug `shell_path` describes was invisible in it.
    let module = page.root.join(&page.module);
    println!("shell: {}", module.display());

    // Taken before anything is started, because the compositor is started with
    // this path in its environment and there is nothing to hand on if the bind
    // has not happened. Taken by this process rather than by a component,
    // because the commands after the first one are not all answered in the
    // same place — and named after this process for the same reason: the
    // display the compositor will bind does not exist yet, and a desktop
    // cannot be named after something that has not happened.
    let control = take(&places.control).map_err(|why| why.to_string())?;
    answering(&control, module_of(&module)?)?;
    println!("{VARIABLE}={}", places.control.display());

    let mut running = Running::new();

    let platform = platform(
        env("OZONE").as_deref(),
        env("WAYLAND_DISPLAY").as_deref(),
        env("DISPLAY").as_deref(),
    )
    .map_err(|why| why.to_string())?;
    println!("the engine is taking the {platform} platform");
    running
        .start(
            "engine",
            &engine(
                &components.engine,
                &page,
                &platform,
                &places,
                env("DOMICILE_ENGINE_ARGS").as_deref(),
            ),
        )
        .map_err(|why| why.to_string())?;
    // Every wait from here down is watched rather than slept through. What a
    // component did instead of the thing being waited for is the answer, and
    // it is most often that it is no longer running — which used to be thirty
    // seconds of nothing followed by a sentence about a socket.
    wait_for(
        &broker(&places.broker, &components.engine),
        &places.broker,
        &mut running,
    )?;

    running
        .start(
            "compositor",
            &compositor(&components.compositor, &components.engine, &places, &env),
        )
        .map_err(|why| why.to_string())?;
    wait_for(&session(&places.session), &places.session, &mut running)?;

    println!();
    println!("domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above.");
    println!("Ctrl-C to stop.");
    // Whichever of the two goes first, said out loud. Waiting on the
    // compositor alone made an engine that died a run that hung: the window
    // was gone, the compositor was still up, and there was nothing on the
    // terminal to read.
    let exit = running.until_one_exits();
    eprintln!("domicile: {}", exit.ended_the_desktop());
    Ok(match exit.how == CLEANLY {
        true => ExitCode::SUCCESS,
        false => ExitCode::FAILURE,
    })
}

/// What `ExitStatus` says about a component that stopped on purpose. Compared
/// as a string because that is what an [`Exit`](domicile_launch::supervise::Exit)
/// carries: the status is kept the way a shell would say it so that a desktop
/// killed by a signal and one that returned 11 do not read the same.
const CLEANLY: &str = "exit status: 0";

/// The module this desktop is running, as a path that means the same thing
/// wherever it is read.
///
/// The command line's is relative to wherever the desktop was started from,
/// and the answer goes to a process that was started somewhere else — a
/// watcher with a working directory of its own, most of the time. `join`
/// rather than a concatenation because an argument that was already absolute
/// replaces the working directory rather than being appended to it.
fn module_of(module: &Path) -> Result<PathBuf, String> {
    let here = std::env::current_dir()
        .map_err(|why| format!("cannot tell where this was started from: {why}"))?;
    Ok(here.join(module))
}

/// Answer the control socket for as long as the desktop is up.
///
/// On a thread of its own because the rest of this program is a supervisor
/// that blocks: it waits on a file, then on a pair of children, and a command
/// arriving in the middle of either is not a command that should wait for
/// them.
///
/// A connection that fails is logged and the next one is taken. There is
/// nothing to recover from — the asker is gone, or said nothing — and a
/// desktop that stopped answering because one client hung up would be a
/// control socket that goes away at the first misbehaving caller.
fn answering(control: &Control, module: PathBuf) -> Result<(), String> {
    let listener = control
        .listener()
        .map_err(|why| format!("cannot answer the control socket: {why}"))?;
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    if let Err(why) =
                        answer_one(stream, ANSWER_WITHIN, &|line| answer(line, &module))
                    {
                        eprintln!("domicile: a command went unanswered: {why}");
                    }
                }
                Err(why) => eprintln!("domicile: a command did not arrive: {why}"),
            }
        }
    });
    Ok(())
}

/// Wait for one milestone against the real world: the filesystem for whether
/// it happened, the components for whether one of them stopped, and the clock
/// for how long it has been.
fn wait_for(milestone: &Milestone, path: &Path, running: &mut Running) -> Result<(), String> {
    let started = Instant::now();
    reach(
        milestone,
        &|| path.exists(),
        &mut || running.exited(),
        &mut || {
            std::thread::sleep(ASK_EVERY);
            started.elapsed()
        },
    )
    .map_err(|stalled| stalled.to_string())
}

/// The engine's half of a desktop: it creates this before anything can be
/// submitted to it, and the compositor is not started until it is there.
fn broker(broker: &Path, engine: &Path) -> Milestone {
    Milestone {
        awaited: format!("the engine's broker socket at {}", broker.display()),
        check: format!(
            "The engine is {} and its own output is above -- an engine that \
             refused a flag, could not take the display, or stopped before it \
             got this far says so there.",
            engine.join("chrome").display()
        ),
        patience: PATIENCE,
    }
}

/// The compositor's half: published once every socket is bound and its window
/// is open, which is the last thing it does before it serves.
fn session(session: &Path) -> Milestone {
    Milestone {
        awaited: format!("the compositor's session document at {}", session.display()),
        check: "The compositor writes it once every socket is bound and its \
                window is open, so anything it could not do comes first in its \
                own output above."
            .to_string(),
        patience: PATIENCE,
    }
}

/// A directory of this run's own, under the runtime directory when there is
/// one. `XDG_RUNTIME_DIR` is the user's and mode 700, which is where sockets
/// belong; `/tmp` is the fallback and is world-readable, so the sockets' own
/// permissions are what protect them there.
fn tempdir() -> std::io::Result<std::path::PathBuf> {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let mine = base.join(format!("domicile-{}", std::process::id()));
    std::fs::create_dir_all(&mine)?;
    Ok(mine)
}
