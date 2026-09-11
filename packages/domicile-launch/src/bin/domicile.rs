//! `domicile ./my-desktop/dist/shell.js` — a desktop, in one command.
//!
//! Everything with a decision in it is a module of `domicile_launch` with
//! tests of its own; this is the part that reads the world and starts things.
//! It is deliberately short, because it is the part nothing can test: no CI
//! runner has a display, and the shell script it replaces was not run by
//! anything either.

use std::path::Path;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use domicile_launch::cli::{invocation, Invocation};
use domicile_launch::components::components;
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
    let env = |name: &str| std::env::var(name).ok();
    let Invocation::Run { shell } =
        invocation(std::env::args().skip(1)).map_err(|why| why.to_string())?;

    let binary = std::env::current_exe().map_err(|why| format!("cannot find myself: {why}"))?;
    let components =
        components(&binary, &env, &|path| path.exists()).map_err(|missing| missing.to_string())?;

    // `DOMICILE_PAGE` names the module, exactly as the argument does — a
    // packaged desktop is a wrapper that types the command line so its user
    // does not have to, and a second spelling of "which shell" would only be
    // a second thing to get wrong.
    let page = shell_module(&shell, env("DOMICILE_PAGE").as_deref(), &|path| {
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
        profile: runtime.join("profile"),
        session: runtime.join("session.json"),
    };

    // What was chosen, before anything is started: a failure below is about
    // this shell, and naming it after the failure is too late to be read. The
    // module rather than its directory, because the directory is what this
    // used to print and it agreed with the wrong file as readily as the right
    // one — the whole of the bug `shell_path` describes was invisible in it.
    println!("shell: {}", page.root.join(&page.module).display());
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
