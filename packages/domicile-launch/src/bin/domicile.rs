//! `domicile ./my-desktop/dist/shell.js` — a desktop, in one command. And
//! `domicile which-shell` — a command for the desktop already running.
//!
//! Everything with a decision in it is a module of `domicile_launch` with
//! tests of its own; this is the part that reads the world and starts things.
//! It is deliberately short, because it is the part nothing can test: no CI
//! runner has a display, and the shell script it replaces was not run by
//! anything either. `scripts/test-the-control-socket.sh` and
//! `scripts/test-a-desktop-that-fails-says-why.sh` are what cover the wiring
//! below that the unit tests cannot reach — the second of them starts this
//! binary against components that die on purpose, which is the only place the
//! restart loop is driven by real processes rather than by a closure.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use domicile_launch::cli::{invocation, Invocation};
use domicile_launch::components::{components, Components};
use domicile_launch::config_path::config_file;
use domicile_launch::control::{answer, Request, Response};
use domicile_launch::control_socket::{
    address, advertised, answer_one, ask, take, Control, PATIENCE as ANSWER_WITHIN, VARIABLE,
};
use domicile_launch::milestones::{reach, Milestone};
use domicile_launch::platform::platform;
use domicile_launch::restart::{clear_the_last_one, keep_a_desktop_up, Attempt, Ending, Policy};
use domicile_launch::shell_path::{shell_module, Shell};
use domicile_launch::spawn::{compositor, engine, Runtime};
use domicile_launch::supervise::{catch_interrupts, interrupted, Running, ASK_EVERY};

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
        Invocation::Run { shell, config } => desktop(&shell, config.as_deref()),
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

/// Run desktops on `shell` — one after another, for as long as they keep
/// failing and [`Policy`] keeps allowing them — with the compositor reading the
/// config file `flag` names or the one where a config lives.
///
/// Whichever it is, the path is handed on rather than read here: what is in it
/// is the compositor's business, and this process opening it first would be a
/// second reader to disagree with — and the one whose complaint arrives before
/// the compositor has said anything about its own file. The one question asked
/// of the filesystem is whether the default is there at all, which is the
/// difference between a path to hand on and none.
fn desktop(shell: &str, flag: Option<&Path>) -> Result<ExitCode, String> {
    let env = |name: &str| std::env::var(name).ok();
    let config = config_file(flag, &env, &|path| path.exists());

    let binary = std::env::current_exe().map_err(|why| format!("cannot find myself: {why}"))?;
    let components =
        components(&binary, &env, &|path| path.exists()).map_err(|missing| missing.to_string())?;

    // WHERE THIS WAS TYPED AND WHOSE HOME `~` IS, because `shell_path` decides
    // what a relative path and a tilde mean and neither is a question about
    // the filesystem. Read here for the same reason the config's default is:
    // this is the part of the program that reads the world.
    let here = std::env::current_dir()
        .map_err(|why| format!("cannot tell where this was started from: {why}"))?;
    let home = env("HOME").map(PathBuf::from);

    // `DOMICILE_PAGE` names the module, exactly as the argument does — a
    // packaged desktop is a wrapper that types the command line so its user
    // does not have to, and a second spelling of "which shell" would only be
    // a second thing to get wrong.
    let page = shell_module(
        shell,
        env("DOMICILE_PAGE").as_deref(),
        &here,
        home.as_deref(),
        &|path| path.metadata().ok().map(|found| found.is_dir()),
    )
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
    // Absolute, because `shell_path` resolved it: the answer below goes to
    // processes that were started somewhere else, with working directories of
    // their own, and a relative path read from one of those is a different
    // file.
    let module = page.root.join(&page.module);
    println!("shell: {}", module.display());
    // Said for the same reason the shell is: a desk that comes up in the wrong
    // arrangement is most often this file being a different one than the
    // person thinks, and the alternative to printing it is reading a process
    // list to find out. Which of the four answers it is and not just the path,
    // now that one of them is a file nobody typed: a `--config` that went to
    // the wrong place and a default that was picked up instead are the same
    // line otherwise.
    println!("config: {config}");

    // Taken before anything is started, because the compositor is started with
    // this path in its environment and there is nothing to hand on if the bind
    // has not happened. Taken by this process rather than by a component,
    // because the commands after the first one are not all answered in the
    // same place — and named after this process for the same reason: the
    // display the compositor will bind does not exist yet, and a desktop
    // cannot be named after something that has not happened.
    let control = take(&places.control).map_err(|why| why.to_string())?;
    answering(&control, module)?;
    println!("{VARIABLE}={}", places.control.display());

    let platform = platform(
        env("OZONE").as_deref(),
        env("WAYLAND_DISPLAY").as_deref(),
        env("DISPLAY").as_deref(),
        env("XDG_VTNR").as_deref(),
    )
    .map_err(|why| why.to_string())?;
    println!("the engine is taking the {platform} platform");

    // BEFORE THE FIRST COMPONENT STARTS, because each one leads a process
    // group of its own and is therefore out of the terminal's foreground
    // group: Ctrl-C reaches this process alone now, and its default action
    // would kill it before the components it started were stopped.
    catch_interrupts();

    // EVERYTHING ABOVE THIS LINE IS DECIDED ONCE AND EVERYTHING BELOW IT CAN
    // BE HAD AGAIN. A missing engine, a refused platform and a control socket
    // that could not be taken are the same answer however many times they are
    // asked, so a run that started them again would be a run that never
    // stopped being wrong; a desktop is a pair of processes and a wait, and
    // that is what is started again. `domicile_launch::restart` holds why the
    // unit is the whole desktop rather than the component that died.
    let policy = Policy::default();
    let desktop = Desktop {
        components: &components,
        config: config.path(),
        env: &env,
        page: &page,
        places: &places,
        platform: &platform,
    };
    let ending = keep_a_desktop_up(
        &policy,
        &mut || one_desktop(&desktop),
        &interrupted,
        &mut wait_or_notice_a_stop,
        &mut |next| eprintln!("domicile: {next}"),
    );
    Ok(match ending {
        Ending::Over => ExitCode::SUCCESS,
        // A stop is not a success, which is what this said before there was
        // anything to restart: a run that was interrupted did not do what it
        // was asked to.
        Ending::Stopped | Ending::GaveUp { .. } => ExitCode::FAILURE,
    })
}

/// Everything one desktop is started from, worked out once and used for every
/// desktop a run has.
struct Desktop<'a> {
    components: &'a Components,
    config: Option<&'a Path>,
    env: &'a dyn Fn(&str) -> Option<String>,
    page: &'a Shell,
    places: &'a Runtime,
    platform: &'a str,
}

/// One desktop, from its first process to its last.
///
/// WHAT THE COMPONENT THAT DID NOT DIE GETS IS THE SAME TEARDOWN AN ORDINARY
/// EXIT GETS, and it gets it here: the [`Running`] holding both is dropped when
/// this returns, which signals each process group and waits for it. That is
/// deliberate rather than incidental — neither component can be replaced under
/// the other, and `domicile_launch::restart` says at which line of which file
/// that is decided.
///
/// The failure is said here rather than carried out, because this is where the
/// sentence is: an exit and a milestone that was never reached each already
/// know how to say what happened.
fn one_desktop(desktop: &Desktop) -> Attempt {
    let started = Instant::now();
    match up(desktop) {
        Ok(()) => Attempt::Ended,
        Err(said) => {
            eprintln!("domicile: {said}");
            Attempt::Failed {
                lived: started.elapsed(),
            }
        }
    }
}

/// Start the two components in the one order they can be started in, and wait
/// for one of them to stop being one.
fn up(desktop: &Desktop) -> Result<(), String> {
    // WHAT THE LAST DESKTOP LEFT WOULD BE READ AS THIS ONE'S. The session
    // document is the one that matters: the wait below is for that file to
    // appear, so one still on disk is a desktop announced up before its
    // compositor has bound anything.
    clear_the_last_one(desktop.places).map_err(|leftover| leftover.to_string())?;

    let mut running = Running::new();
    running
        .start(
            "engine",
            &engine(
                &desktop.components.engine,
                desktop.page,
                desktop.platform,
                desktop.places,
                (desktop.env)("DOMICILE_ENGINE_ARGS").as_deref(),
            ),
        )
        .map_err(|why| why.to_string())?;
    // Every wait from here down is watched rather than slept through. What a
    // component did instead of the thing being waited for is the answer, and
    // it is most often that it is no longer running — which used to be thirty
    // seconds of nothing followed by a sentence about a socket.
    wait_for(
        &broker(&desktop.places.broker, &desktop.components.engine),
        &desktop.places.broker,
        &mut running,
    )?;

    running
        .start(
            "compositor",
            &compositor(
                &desktop.components.compositor,
                &desktop.components.engine,
                desktop.places,
                desktop.config,
                desktop.env,
            ),
        )
        .map_err(|why| why.to_string())?;
    wait_for(
        &session(&desktop.places.session),
        &desktop.places.session,
        &mut running,
    )?;

    println!();
    println!("domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above.");
    println!("Ctrl-C to stop.");
    // Whichever of the two goes first, said out loud. Waiting on the
    // compositor alone made an engine that died a run that hung: the window
    // was gone, the compositor was still up, and there was nothing on the
    // terminal to read.
    let exit = running.until_one_exits();
    match exit.how == CLEANLY {
        true => Ok(()),
        false => Err(exit.to_string()),
    }
}

/// Wait out the backoff, in the same slices everything else here waits in, so
/// that a Ctrl-C between two desktops is noticed when it arrives rather than
/// when the next one would have started.
///
/// Returning early is not the answer to the stop and does not have to be: the
/// caller asks [`interrupted`] again the moment this returns.
fn wait_or_notice_a_stop(wait: Duration) {
    let until = Instant::now() + wait;
    while Instant::now() < until && !interrupted() {
        std::thread::sleep(ASK_EVERY);
    }
}

/// What `ExitStatus` says about a component that stopped on purpose. Compared
/// as a string because that is what an [`Exit`](domicile_launch::supervise::Exit)
/// carries: the status is kept the way a shell would say it so that a desktop
/// killed by a signal and one that returned 11 do not read the same.
const CLEANLY: &str = "exit status: 0";

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
/// it happened, the components for whether one of them stopped, the signal
/// handler's flag for whether a stop has been asked for, and the clock for how
/// long it has been.
///
/// The flag is read here as well as in [`Running::until_one_exits`], because
/// between them is where a run spends its first minute. A Ctrl-C in that
/// minute used to do nothing at all — see [`reach`] for what that leaves on a
/// tty.
fn wait_for(milestone: &Milestone, path: &Path, running: &mut Running) -> Result<(), String> {
    let started = Instant::now();
    reach(
        milestone,
        &|| path.exists(),
        &mut || running.exited(),
        &interrupted,
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
