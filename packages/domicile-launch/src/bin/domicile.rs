//! `domicile ./my-desktop/dist/shell.js` — a desktop, in one command. And
//! `domicile which-shell` or `domicile load-shell <path>` — commands for the
//! desktop already running.
//!
//! Everything with a decision in it is a module of `domicile_launch` with
//! tests of its own; this is the part that reads the world and starts things.
//! It is deliberately short, because it is the part nothing can test: no CI
//! runner has a display, and the shell script it replaces was not run by
//! anything either. `scripts/test-the-control-socket.sh` and
//! `scripts/test-a-desktop-that-fails-says-why.sh` are what cover the wiring
//! below that the unit tests cannot reach — the second of them starts this
//! binary against components that die on purpose, which is the only place the
//! restart loop is driven by real processes rather than by a closure, and
//! `scripts/test-a-running-desktop-takes-a-new-shell.sh` is where a
//! `load-shell` goes all the way from a command line to an engine's socket.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use domicile_launch::cli::{invocation, Invocation};
use domicile_launch::command_socket::load_shell;
use domicile_launch::components::{components, Components};
use domicile_launch::config_path::config_file;
use domicile_launch::control::{answer, Request, Response};
use domicile_launch::control_socket::{
    address, advertised, answer_one, ask, take, Control, PATIENCE as ANSWER_WITHIN, VARIABLE,
};
use domicile_launch::heard::Heard;
use domicile_launch::milestones::{reach, Milestone};
use domicile_launch::platform::platform;
use domicile_launch::profile_path::profile_directory;
use domicile_launch::restart::{
    clear_the_last_engine, clear_the_last_one, keep_a_desktop_up, keep_the_engine_up, Attempt,
    Ending, Policy,
};
use domicile_launch::shell_path::{shell_module, Shell};
use domicile_launch::spawn::{compositor, engine, Runtime};
use domicile_launch::supervise::{catch_interrupts, interrupted, Running, ASK_EVERY};

/// How long each component gets to do the one thing the next one waits on. A
/// debug build on a loaded machine is seconds, not milliseconds.
const PATIENCE: Duration = Duration::from_secs(30);

/// How many of the compositor's last lines a run that gave up says again.
///
/// The complaint about a config it could not read is six lines, so twenty is
/// room for the shape of one rather than a guess at a size. The cap is for the
/// other end: a desktop that came up, was used and then panicked leaves a
/// backtrace on that stream, and repeating all of it would bury the repeat the
/// way the original was buried.
const WORTH_REPEATING: usize = 20;

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
        Invocation::Load { shell } => asked(&shell_to_load(&shell)?),
    }
}

/// Which shell `domicile load-shell <path>` names, resolved here and sent
/// resolved.
///
/// IN FRONT OF THE PERSON WHO TYPED IT. A relative path and a `~` mean what
/// they mean on this command line, in this terminal — and neither the desktop
/// answering the control socket nor the engine serving the page shares this
/// working directory. So the same [`shell_module`] a run resolves its own
/// shell with resolves this one, against the same filesystem, and a typo is
/// answered here rather than by an engine reporting a module that would not
/// load.
///
/// `DOMICILE_PAGE` has no part in it: a packaged desktop hands over the module
/// it was built with, and this command is somebody naming another one.
fn shell_to_load(shell: &str) -> Result<Request, String> {
    let here = std::env::current_dir()
        .map_err(|why| format!("cannot tell where this was typed: {why}"))?;
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let page = shell_module(shell, None, &here, home.as_deref(), &|path| {
        path.metadata().ok().map(|found| found.is_dir())
    })
    .map_err(|why| why.to_string())?;
    Ok(Request::LoadShell {
        module: page.module,
        root: page.root,
    })
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

    // Kept between runs, unlike everything below it: a profile thrown away
    // with the run is every sign-in thrown away with it. Refused rather than
    // guessed when nothing names a home, because a person's logins kept
    // somewhere nobody named are logins nobody can find to delete.
    let profile = profile_directory(&env)
        .ok_or("nowhere to keep the engine's profile -- neither XDG_STATE_HOME nor HOME is set")?;

    // One directory per run, thrown away with it. The sockets go in it, so a
    // desktop that exits leaves nothing behind and two running at once do not
    // meet.
    let runtime = tempdir().map_err(|why| format!("no runtime directory: {why}"))?;
    let places = Runtime {
        broker: runtime.join("broker"),
        chrome_socket: runtime.join("chrome.sock"),
        command: runtime.join("command.sock"),
        control: address(env("XDG_RUNTIME_DIR").as_deref(), std::process::id()),
        profile,
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
    // A path nobody typed, and the one that decides which sign-ins a desk
    // comes up with.
    println!("profile: {}", places.profile.display());

    // Taken before anything is started, because the compositor is started with
    // this path in its environment and there is nothing to hand on if the bind
    // has not happened. Taken by this process rather than by a component,
    // because the commands after the first one are not all answered in the
    // same place — and named after this process for the same reason: the
    // display the compositor will bind does not exist yet, and a desktop
    // cannot be named after something that has not happened.
    let control = take(&places.control).map_err(|why| why.to_string())?;
    answering(&control, module, places.command.clone())?;
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
    // stopped being wrong. What is started again is an engine, for as long as
    // there is a compositor to put one under, and a whole desktop when there
    // is not. `domicile_launch::restart` holds why those are the two units.
    let policy = Policy::default();
    let desktop = Desktop {
        components: &components,
        config: config.path(),
        env: &env,
        page: &page,
        places: &places,
        platform: &platform,
        policy: &policy,
    };
    // What the last desktop's compositor said, kept across the loop so that a
    // run which gives up ends on the reason rather than on a pointer to it.
    // The *last* one and not all five: they are the same six lines five times
    // over, and a repeat of thirty is the wall this exists to cut down.
    let mut said = None;
    let ending = keep_a_desktop_up(
        &policy,
        &mut || one_desktop(&desktop, &mut said),
        &interrupted,
        &mut wait_or_notice_a_stop,
        &mut |next| eprintln!("domicile: {next}"),
    );
    Ok(match ending {
        Ending::Over => ExitCode::SUCCESS,
        // A stop is not a success, which is what this said before there was
        // anything to restart: a run that was interrupted did not do what it
        // was asked to.
        Ending::Stopped => ExitCode::FAILURE,
        // THE LAST THING ON THE TERMINAL IS THE ONE THING ANYONE READS, and
        // for a desk that would not come up it used to be "every one of them
        // said why above" -- true, and a pointer into two hundred lines of
        // Chromium's startup log. The compositor's own words go here instead.
        //
        // Only where there are any: a run whose engine never started has
        // nothing of the compositor's to repeat, and the pointer is then the
        // honest answer rather than a heading over an empty quote.
        Ending::GaveUp { .. } => {
            match &said {
                Some(said) => eprintln!("\ndomicile: the last compositor said:\n\n{said}"),
                None => eprintln!("domicile: every one of them said why above."),
            }
            ExitCode::FAILURE
        }
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
    /// Shared by the two loops and counted separately by each: how long an
    /// engine started again waits is the same question as how long a desktop
    /// started again waits, and the answer is not two numbers.
    policy: &'a Policy,
}

/// One desktop, from its first process to its last.
///
/// A DESKTOP IS AS LONG AS ITS COMPOSITOR, AND THAT IS WHAT MAKES ONE THE
/// UNIT. An engine that dies inside it is replaced inside it — the loop for
/// that is in [`up`] — so the failure that reaches here is a compositor that
/// went, or an engine that would not stay up under one that did not. Whichever
/// it was, the [`Running`] holding both is dropped when this returns, which
/// signals each process group and waits for it.
/// `domicile_launch::restart` holds why the compositor is the half that cannot
/// be replaced under the other.
///
/// The failure is said here rather than carried out, because this is where the
/// sentence is: an exit and a milestone that was never reached each already
/// know how to say what happened.
fn one_desktop(desktop: &Desktop, said: &mut Option<String>) -> Attempt {
    // One per desktop rather than one per run: each attempt's compositor is a
    // new process with its own reason, and a tail shared across five would be
    // five reasons deep and the earliest of them cut in half.
    let heard = Arc::new(Mutex::new(Heard::new(WORTH_REPEATING)));
    let started = Instant::now();
    let attempt = match up(desktop, &heard) {
        Ok(()) => Attempt::Ended,
        Err(why) => {
            eprintln!("domicile: {why}");
            Attempt::Failed {
                lived: started.elapsed(),
            }
        }
    };
    // After `up`, which is after its `Running` was dropped -- and that drop is
    // what ends the listener and joins it, so everything the compositor said
    // is in hand by this line. See `supervise::Running::drop`.
    *said = heard
        .lock()
        .expect("nothing panics holding what a component said")
        .said();
    attempt
}

/// Start the two components in the one order they can be started in, keep an
/// engine under the compositor for as long as the compositor lasts, and return
/// when the compositor does not.
fn up(desktop: &Desktop, heard: &Arc<Mutex<Heard>>) -> Result<(), String> {
    // WHAT THE LAST DESKTOP LEFT WOULD BE READ AS THIS ONE'S. The session
    // document is the one that matters: the wait below is for that file to
    // appear, so one still on disk is a desktop announced up before its
    // compositor has bound anything.
    clear_the_last_one(desktop.places).map_err(|leftover| leftover.to_string())?;

    let mut running = Running::new();
    start_an_engine(desktop, &mut running)?;

    // Overheard, where the engine is not: this one's stderr is its own -- its
    // tracing goes to stdout -- so what arrives is the fatal complaint and
    // nothing else, while the engine's is Chromium's and is the volume being
    // cut through.
    running
        .start_overheard(
            "compositor",
            &compositor(
                &desktop.components.compositor,
                &desktop.components.engine,
                desktop.places,
                desktop.config,
                desktop.env,
            ),
            heard,
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

    // AN ENGINE THAT DIES IS REPLACED UNDER THE COMPOSITOR AND A COMPOSITOR
    // THAT DIES IS NOT. `domicile_launch::restart` holds which way round that
    // is and why; what it means here is that the loop below is the engine's,
    // and the one thing that ends it is the compositor — whose death, or whose
    // clean exit, is this desktop being over.
    //
    // `over` carries that out rather than being returned, because the loop's
    // own return value is about the engine: `Ending::Over` is "the attempt
    // said there is nothing more to start", and what actually happened is the
    // exit the attempt saw.
    let mut over = None;
    let mut first = true;
    let ending = keep_the_engine_up(
        desktop.policy,
        &mut || one_engine(desktop, &mut running, &mut first, &mut over),
        &interrupted,
        &mut wait_or_notice_a_stop,
        &mut |next| eprintln!("domicile: {next}"),
    );
    match ending {
        Ending::Over => over.expect("the engine's loop ends on an exit it recorded"),
        Ending::Stopped => Err("a stop was asked for".to_string()),
        // Not this loop's to fix. A whole new desktop is a different thing to
        // try — a fresh compositor, a fresh page, a directory cleared of
        // everything either of them bound — and the loop that stands one up is
        // the caller's.
        Ending::GaveUp { failures } => Err(format!(
            "{failures} engines in a row have failed under this compositor, so the desktop \
             goes with them"
        )),
    }
}

/// One engine, from the process starting to whatever ended the wait.
///
/// `first` is whether the engine this attempt is about has already been
/// started — the first one of a desktop is, above, because the compositor
/// cannot be started until its broker socket is there. Every one after it is
/// started here, which is what puts it AFTER the backoff the last one's death
/// earned rather than before it.
///
/// [`Attempt::Ended`] is the compositor going rather than the engine, and the
/// exit that says so is put in `over` for [`up`] to return: there is nothing
/// left to put an engine under, so this desktop is finished either way.
fn one_engine(
    desktop: &Desktop,
    running: &mut Running,
    first: &mut bool,
    over: &mut Option<Result<(), String>>,
) -> Attempt {
    let started = Instant::now();
    if !*first {
        // What the last engine bound and the next one binds over. NOT the
        // compositor's socket or its session document, which are a live
        // desktop's — see `clear_the_last_engine`.
        let cleared = clear_the_last_engine(desktop.places)
            .map_err(|leftover| leftover.to_string())
            .and_then(|()| start_an_engine(desktop, running));
        if let Err(why) = cleared {
            eprintln!("domicile: {why}");
            return Attempt::Failed {
                lived: started.elapsed(),
            };
        }
    }
    *first = false;
    let exit = running.until_one_exits();
    match exit.what == "engine" && exit.how != CLEANLY {
        // The compositor is still serving, its clients are still connected,
        // and it re-dials the engine that replaces this one the moment that
        // engine's page reaches it -- `engine_restart` in the compositor is
        // the other half of this sentence.
        true => {
            // SAID HERE, because this is the one exit nothing further up sees:
            // `one_desktop` prints what `up` returns, and what `up` returns
            // for a desktop that is still serving is nothing at all. An engine
            // that went without a line saying which status it went with is a
            // window that vanished for no stated reason.
            eprintln!("domicile: {exit}");
            running.let_go_of("engine");
            Attempt::Failed {
                lived: started.elapsed(),
            }
        }
        false => {
            *over = Some(match exit.how == CLEANLY {
                true => Ok(()),
                false => Err(exit.to_string()),
            });
            Attempt::Ended
        }
    }
}

/// Start an engine and wait for the broker socket it exists to create.
///
/// Every wait here is watched rather than slept through. What a component did
/// instead of the thing being waited for is the answer, and it is most often
/// that it is no longer running — which used to be thirty seconds of nothing
/// followed by a sentence about a socket.
fn start_an_engine(desktop: &Desktop, running: &mut Running) -> Result<(), String> {
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
    wait_for(
        &broker(&desktop.places.broker, &desktop.components.engine),
        &desktop.places.broker,
        running,
    )
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

/// Answer the control socket for as long as the desktop is up, with `engine`
/// the socket the one command that routes is routed to.
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
///
/// WHICH SHELL IS SERVED IS KEPT HERE, and it changes: a `load-shell` the
/// engine carried out makes every later `which-shell` a different answer, and
/// a supervisor that went on naming the module its run started with would be
/// answering for a desktop that no longer exists. Read out before the line is
/// answered and written after the engine has taken it, so the dial never
/// happens with the lock held.
fn answering(control: &Control, module: PathBuf, engine: PathBuf) -> Result<(), String> {
    let listener = control
        .listener()
        .map_err(|why| format!("cannot answer the control socket: {why}"))?;
    std::thread::spawn(move || {
        let serving = Mutex::new(module);
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    if let Err(why) = answer_one(stream, ANSWER_WITHIN, &|line| {
                        answer(line, &shell(&serving), &|root, module| {
                            load_the_shell(&engine, root, module, &serving)
                        })
                    }) {
                        eprintln!("domicile: a command went unanswered: {why}");
                    }
                }
                Err(why) => eprintln!("domicile: a command did not arrive: {why}"),
            }
        }
    });
    Ok(())
}

/// The module this desktop is serving as of this command.
fn shell(serving: &Mutex<PathBuf>) -> PathBuf {
    serving
        .lock()
        .expect("nothing panics holding which shell is served")
        .clone()
}

/// Put one `load_shell` to the engine, and remember what it is serving once it
/// has taken it.
///
/// Written only on the way out of a load the engine answered `loaded` to: an
/// engine that refused is still serving what it was, and a supervisor that
/// wrote first would answer `which-shell` with a shell nothing is on.
fn load_the_shell(
    engine: &Path,
    root: &Path,
    module: &Path,
    serving: &Mutex<PathBuf>,
) -> Result<(), String> {
    load_shell(engine, root, module, ANSWER_WITHIN).map_err(|why| why.to_string())?;
    *serving
        .lock()
        .expect("nothing panics holding which shell is served") = root.join(module);
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
