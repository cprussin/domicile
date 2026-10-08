//! The `domicile` binary: runs a desktop, or sends a command to a running one.
//!
//! Logic with decisions lives in `domicile_launch` with unit tests. This file
//! only reads the environment and starts processes, which CI cannot test
//! without a display. These scripts cover the wiring:
//! - `scripts/test-the-control-socket.sh`
//! - `scripts/test-a-desktop-that-fails-says-why.sh` (restart loop with real
//!   processes)
//! - `scripts/test-a-running-desktop-takes-a-new-shell.sh` (`load-shell`
//!   end to end)

use std::io::{BufRead, BufReader, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use domicile_launch::address::url_for;
use domicile_launch::build_progress::{bar, heard, Heard as BuilderHeard};
use domicile_launch::cli::{invocation, CliError, Invocation};
use domicile_launch::command_socket::{load_shell, open_url, screenshot};
use domicile_launch::components::{builder, components, our_shell, Components};
use domicile_launch::config_check::check;
use domicile_launch::config_path::{config_file, is_module, ConfigFile};
use domicile_launch::config_watch;
use domicile_launch::control::{answer, Request, Response};
use domicile_launch::control_socket::{
    address, advertised, answer_one, ask, take, Control, PATIENCE as ANSWER_WITHIN, VARIABLE,
};
use domicile_launch::graphical_session;
use domicile_launch::heard::Heard;
use domicile_launch::milestones::{reach, Milestone};
use domicile_launch::notification;
use domicile_launch::platform::platform;
use domicile_launch::profile_claim::claim;
use domicile_launch::profile_path::profile_directory;
use domicile_launch::restart::{
    clear_the_last_engine, clear_the_last_one, keep_a_desktop_up, keep_the_engine_up, Attempt,
    Ending, Policy,
};
use domicile_launch::session::Session;
use domicile_launch::shell_path::Shell;
use domicile_launch::shell_source::{shell_source, ShellSource};
use domicile_launch::spawn::{compositor, engine, Runtime};
use domicile_launch::supervise::{catch_interrupts, interrupted, Running, ASK_EVERY};

/// How long each startup milestone may take. A debug build on a loaded
/// machine takes seconds.
const PATIENCE: Duration = Duration::from_secs(30);

/// How long a screenshot may take: the engine reads back the whole desk and
/// encodes a PNG, which for several 4K monitors takes seconds.
const CAPTURE_WITHIN: Duration = Duration::from_secs(10);

/// How many of the compositor's last stderr lines to repeat when a run gives
/// up.
///
/// Fits a typical config error (about six lines) without repeating a whole
/// panic backtrace.
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
        Invocation::Run { shell, config } => desktop(shell.as_deref(), config.as_deref()),
        Invocation::Ask { request } => asked(&request),
        Invocation::Load { shell } => asked(&shell_to_load(&shell)?),
        Invocation::Open { target } => asked(&Request::OpenUrl {
            url: url_for(
                &target,
                &std::env::current_dir()
                    .map_err(|why| format!("cannot tell where this was typed: {why}"))?,
            ),
        }),
        // Absolute here, since the engine does not share this working
        // directory.
        Invocation::Screenshot { file } => asked(&Request::Screenshot {
            file: std::path::absolute(&file)
                .map_err(|why| format!("cannot tell where {file} is: {why}"))?,
        }),
        Invocation::Check { config } => check(&config).map(|()| ExitCode::SUCCESS),
    }
}

/// Resolves the shell for `domicile load-shell` on the client side.
///
/// Relative paths and `~` must resolve in the user's terminal, since neither
/// the desktop nor the engine shares its working directory. Builds happen here
/// too, so the user sees errors and progress. `DOMICILE_PAGE` is ignored.
fn shell_to_load(shell: &str) -> Result<Request, String> {
    let page = shell_named(shell, None, None)?;
    Ok(Request::LoadShell {
        module: page.module,
        root: page.root,
    })
}

/// The module `shell` names, built first if it is an entry or a package.
///
/// `from` is the base for relative paths when the shell came from a config
/// file: the config's directory. Otherwise the working directory is used.
fn shell_named(shell: &str, handed_in: Option<&str>, from: Option<&Path>) -> Result<Shell, String> {
    let env = |name: &str| std::env::var(name).ok();
    let here = match from {
        Some(directory) => directory.to_path_buf(),
        None => std::env::current_dir()
            .map_err(|why| format!("cannot tell where this was typed: {why}"))?,
    };
    let home = env("HOME").map(PathBuf::from);
    let source = shell_source(
        shell,
        handed_in,
        &here,
        home.as_deref(),
        &|path| path.metadata().ok().map(|found| found.is_dir()),
        &|path| std::fs::read_to_string(path).ok(),
    )
    .map_err(|why| why.to_string())?;
    let binary = std::env::current_exe().map_err(|why| format!("cannot find myself: {why}"))?;
    match source {
        ShellSource::Module(page) => Ok(page),
        // Prebuilt in the install, so no build is needed.
        ShellSource::Ours(name) => our_shell(&binary, &name, &env, &|path| path.exists())
            .map(|root| Shell {
                root,
                module: PathBuf::from("shell.js"),
            })
            .map_err(|missing| missing.to_string()),
        ShellSource::Entry(entry) => {
            built(&binary, &["--entry".into(), entry.into_os_string()]).and_then(as_shell)
        }
        ShellSource::Package(spec) => {
            built(&binary, &["--package".into(), spec.into()]).and_then(as_shell)
        }
    }
}

/// Runs the shell builder and returns its final result, showing progress.
///
/// On a terminal the bar redraws in place; otherwise each step is one line.
/// Build log lines are printed only if the build fails.
fn built(binary: &Path, asked: &[std::ffi::OsString]) -> Result<BuilderHeard, String> {
    let env = |name: &str| std::env::var(name).ok();
    let builder =
        builder(binary, &env, &|path| path.exists()).map_err(|missing| missing.to_string())?;
    let cache = env("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| env("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .ok_or("nowhere to keep built shells -- neither XDG_CACHE_HOME nor HOME is set")?
        .join("domicile")
        .join("shells");
    let mut child = Command::new(&builder)
        .args(asked)
        .arg("--cache")
        .arg(&cache)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|why| {
            format!(
                "cannot start the shell builder {}: {why}",
                builder.display()
            )
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or("the shell builder has no stdout")?;
    let terminal = std::io::stderr().is_terminal();
    let mut log = Vec::new();
    let mut answer = None;
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|why| format!("cannot read the shell builder: {why}"))?;
        match heard(&line) {
            BuilderHeard::Step(step) if terminal => {
                eprint!("\r\x1b[K{}", bar(&step));
                let _ = std::io::stderr().flush();
            }
            BuilderHeard::Step(step) => eprintln!("domicile: {}", bar(&step)),
            BuilderHeard::Log(said) => log.push(said),
            BuilderHeard::Failed(why) => answer = Some(Err(why)),
            done => answer = Some(Ok(done)),
        }
    }
    if terminal {
        eprint!("\r\x1b[K");
    }
    let status = child
        .wait()
        .map_err(|why| format!("cannot wait for the shell builder: {why}"))?;
    match answer {
        Some(Ok(done)) if status.success() => Ok(done),
        Some(Err(why)) => Err(format!(
            "the shell did not build: {why}\n{}",
            log.join("\n")
        )),
        _ => Err(format!(
            "the shell builder stopped ({status}) without saying it built anything\n{}",
            log.join("\n")
        )),
    }
}

/// Extracts the built module from the builder's result.
fn as_shell(heard: BuilderHeard) -> Result<Shell, String> {
    match heard {
        BuilderHeard::Built(page) => Ok(page),
        other => Err(format!("the shell builder answered a build with {other:?}")),
    }
}

/// Evaluates the module config at `config` to JSON with the builder.
fn evaluated_json(binary: &Path, config: &Path) -> Result<PathBuf, String> {
    match built(
        binary,
        &["--evaluate".into(), config.as_os_str().to_os_string()],
    )? {
        BuilderHeard::Evaluated(json) => Ok(json),
        other => Err(format!(
            "the shell builder answered an evaluation with {other:?}"
        )),
    }
}

/// The `shell` key of a JSON config, if any. The compositor reads the other
/// keys.
fn shell_in(config: &Path) -> Option<String> {
    let json = config
        .extension()
        .is_some_and(|extension| extension == "json");
    json.then(|| std::fs::read_to_string(config).ok())
        .flatten()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("shell")?.as_str().map(str::to_string))
}

/// The directory containing `config`, which a shell it names is relative to.
fn beside(config: &Path) -> PathBuf {
    config
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
}

/// Sends one request to the running desktop and prints its response.
fn asked(request: &Request) -> Result<ExitCode, String> {
    let socket =
        advertised(std::env::var(VARIABLE).ok().as_deref()).map_err(|why| why.to_string())?;
    let patience = match request {
        // Longer than the supervisor waits for the engine, so the engine's
        // own failure reaches this terminal rather than a timeout.
        Request::Screenshot { .. } => CAPTURE_WITHIN + ANSWER_WITHIN,
        _ => ANSWER_WITHIN,
    };
    let answer = ask(&socket, request, patience).map_err(|why| why.to_string())?;
    match answer {
        Response::Shell { module } => {
            println!("{}", module.display());
            Ok(ExitCode::SUCCESS)
        }
        Response::Opened => Ok(ExitCode::SUCCESS),
        Response::Captured { file } => {
            println!("{}", file.display());
            Ok(ExitCode::SUCCESS)
        }
        // Print the desktop's own reason.
        Response::Refused { why } => {
            eprintln!("domicile: {why}");
            Ok(ExitCode::FAILURE)
        }
    }
}

/// Runs desktops on `shell`, restarting them while [`Policy`] allows.
///
/// The config path is passed to the compositor without being read here, so
/// only one process reports errors in it. A module config is first evaluated
/// to JSON by the builder, since the compositor runs no JavaScript. With no
/// `shell`, the config's `Shell` export or `shell` key is used, relative to
/// the config.
fn desktop(shell: Option<&str>, flag: Option<&Path>) -> Result<ExitCode, String> {
    let env = |name: &str| std::env::var(name).ok();
    let config = config_file(flag, &env, &|path| path.exists());
    if let ConfigFile::Several(_) = config {
        return Err(format!("config: {config}"));
    }

    let binary = std::env::current_exe().map_err(|why| format!("cannot find myself: {why}"))?;
    let (compositor_config, named) = match config.path() {
        Some(path) if is_module(path) => (
            Some(evaluated_json(&binary, path)?),
            Some((path.display().to_string(), beside(path))),
        ),
        Some(path) => (
            Some(path.to_path_buf()),
            shell_in(path).map(|named| (named, beside(path))),
        ),
        None => (None, None),
    };
    let components =
        components(&binary, &env, &|path| path.exists()).map_err(|missing| missing.to_string())?;
    // `BROWSER` for apps in this desktop, installed next to this binary.
    let browser = binary.with_file_name("domicile-open-url");

    // `DOMICILE_PAGE` names the module like the argument does, for packaged
    // desktops. Build before starting anything, so a broken shell starts
    // nothing.
    let page = match (shell, named) {
        (Some(shell), _) => shell_named(shell, env("DOMICILE_PAGE").as_deref(), None)?,
        (None, Some((named, from))) => shell_named(&named, None, Some(&from))?,
        (None, None) => return Err(CliError::NoShell.to_string()),
    };

    // The profile persists across runs to keep sign-ins. Fail rather than
    // guess a location, so the user can always find and delete it.
    let kept = profile_directory(&env)
        .ok_or("nowhere to keep the engine's profile -- neither XDG_STATE_HOME nor HOME is set")?;
    // Held for the whole run: two engines cannot share a profile.
    let profile = claim(&kept)
        .map_err(|why| format!("cannot claim a profile beside {}: {why}", kept.display()))?;

    // A per-run directory for sockets, so concurrent desktops do not collide.
    let runtime = tempdir().map_err(|why| format!("no runtime directory: {why}"))?;
    let places = Runtime {
        broker: runtime.join("broker"),
        chrome_socket: runtime.join("chrome.sock"),
        command: runtime.join("command.sock"),
        control: address(env("XDG_RUNTIME_DIR").as_deref(), std::process::id()),
        profile: profile.path.clone(),
        shims: runtime.join("bin"),
        session: runtime.join("session.json"),
    };
    shim_xdg_open(&places.shims, &binary.with_file_name("domicile-xdg-open"))?;

    // Print the choices before starting anything, so later failures can be
    // read against them. Print the absolute module path, not its directory, so
    // a wrong file is visible.
    let module = page.root.join(&page.module);
    println!("shell: {}", module.display());
    // Print how the config was chosen; a wrong config is a common cause of a
    // wrong monitor layout.
    println!("config: {config}");
    // The profile decides which sign-ins the desktop has.
    println!("profile: {}", places.profile.display());

    // Bind before starting components, which inherit the path. The
    // supervisor owns it because it routes some commands to the engine, and it
    // is keyed on the pid because no Wayland display exists yet.
    let control = take(&places.control).map_err(|why| why.to_string())?;
    let serving = Arc::new(Mutex::new(module));
    answering(&control, Arc::clone(&serving), places.command.clone())?;
    println!("{VARIABLE}={}", places.control.display());

    // Watch a module config's directory. On an edit, re-evaluate it into the
    // JSON the compositor watches, and if the config is also the shell,
    // rebuild and load it. A failure is reported and changes nothing.
    let compositor_config = match (config.path(), compositor_config) {
        (Some(module_config), Some(evaluated)) if is_module(module_config) => {
            let stable = runtime.join("config.json");
            std::fs::copy(&evaluated, &stable)
                .map_err(|why| format!("cannot place the evaluated config: {why}"))?;
            Some(stable)
        }
        (_, other) => other,
    };
    let _watching = match config.path() {
        Some(module_config) if is_module(module_config) => Some(watching_the_config(
            &binary,
            module_config,
            compositor_config
                .clone()
                .expect("a module config was evaluated"),
            shell
                .is_none()
                .then(|| (Arc::clone(&serving), places.command.clone())),
        )?),
        _ => None,
    };

    let platform = platform(
        env("OZONE").as_deref(),
        env("WAYLAND_DISPLAY").as_deref(),
        env("DISPLAY").as_deref(),
        env("XDG_VTNR").as_deref(),
    )
    .map_err(|why| why.to_string())?;
    println!("the engine is taking the {platform} platform");

    // Install before starting components. Each runs in its own process
    // group, so Ctrl-C reaches only this process, whose default action would
    // exit without stopping them.
    catch_interrupts();

    // Everything above runs once, since retrying would give the same result.
    // Below, the engine restarts while the compositor lives, and the whole
    // desktop restarts otherwise. See `domicile_launch::restart`.
    let policy = Policy::default();
    // Held for the whole run. Dropping it ends the graphical session.
    let said = SaidSession::new(&platform);
    let desktop = Desktop {
        browser: &browser,
        components: &components,
        config: compositor_config.as_deref(),
        env: &env,
        page: &page,
        places: &places,
        platform: &platform,
        policy: &policy,
        said: &said,
    };
    // The last desktop's compositor output, repeated if the run gives up.
    // Only the last, since each attempt usually fails the same way.
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
        // An interrupted run did not finish what was asked.
        Ending::Stopped => ExitCode::FAILURE,
        // End on the compositor's own error, since the last line is what users
        // read. If the compositor never ran, point to the output above.
        Ending::GaveUp { .. } => {
            match &said {
                Some(said) => eprintln!("\ndomicile: the last compositor said:\n\n{said}"),
                None => eprintln!("domicile: every one of them said why above."),
            }
            ExitCode::FAILURE
        }
    })
}

/// Inputs shared by every desktop a run starts.
struct Desktop<'a> {
    browser: &'a Path,
    components: &'a Components,
    config: Option<&'a Path>,
    env: &'a dyn Fn(&str) -> Option<String>,
    page: &'a Shell,
    places: &'a Runtime,
    platform: &'a str,
    /// The restart policy, shared by the engine and desktop loops. Each loop
    /// counts its own failures.
    policy: &'a Policy,
    /// The graphical session registration, renewed by each desktop.
    said: &'a SaidSession,
}

/// Runs one desktop until its compositor exits.
///
/// Engine restarts happen inside [`up`]. Returning drops the [`Running`],
/// which stops every process group. See `domicile_launch::restart` for why the
/// compositor cannot be replaced on its own.
fn one_desktop(desktop: &Desktop, said: &mut Option<String>) -> Attempt {
    // One per desktop, so the tail holds only this compositor's output.
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
    // `up` dropped its `Running`, which joins the stderr listener, so all
    // output is captured. See `supervise::Running::drop`.
    *said = heard
        .lock()
        .expect("nothing panics holding what a component said")
        .said();
    attempt
}

/// Starts the engine, then the compositor, and restarts the engine until the
/// compositor exits.
fn up(desktop: &Desktop, heard: &Arc<Mutex<Heard>>) -> Result<(), String> {
    // Remove the last desktop's files. A stale session document would make
    // the wait below succeed too early.
    clear_the_last_one(desktop.places).map_err(|leftover| leftover.to_string())?;

    let mut running = Running::new();
    start_an_engine(desktop, &mut running)?;

    // Capture only the compositor's stderr; see `domicile_launch::heard`.
    running
        .start_overheard(
            "compositor",
            &compositor(
                &desktop.components.compositor,
                &desktop.components.engine,
                desktop.browser,
                &data_of(desktop.browser)?,
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
    desktop.said.say(desktop.places);

    println!();
    println!("domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above.");
    println!("Ctrl-C to stop.");

    // Restart the engine until the compositor exits; see
    // `domicile_launch::restart`. `over` records how the compositor exited,
    // because the loop's own result describes the engine.
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
        // The caller restarts the whole desktop.
        Ending::GaveUp { failures } => Err(format!(
            "{failures} engines in a row have failed under this compositor, so the desktop \
             goes with them"
        )),
    }
}

/// Runs one engine until a component exits.
///
/// `first` is true when [`up`] already started this engine, since the
/// compositor needs its broker socket. Later engines start here, after the
/// backoff. A compositor exit returns [`Attempt::Ended`] and stores the result
/// in `over` for [`up`].
fn one_engine(
    desktop: &Desktop,
    running: &mut Running,
    first: &mut bool,
    over: &mut Option<Result<(), String>>,
) -> Attempt {
    let started = Instant::now();
    if !*first {
        // Clear only the engine's files; the compositor is still live. See
        // `clear_the_last_engine`.
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
        // The compositor keeps serving and reconnects to the next engine; see
        // `engine_restart` in the compositor.
        true => {
            // Print here: no caller reports an engine exit while the desktop
            // is still up.
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

/// Starts an engine and waits for its broker socket.
///
/// The wait also watches for exits, so a crash is reported at once.
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

/// Sleeps for the backoff, returning early on a stop request.
///
/// The caller checks [`interrupted`] again on return.
fn wait_or_notice_a_stop(wait: Duration) {
    let until = Instant::now() + wait;
    while Instant::now() < until && !interrupted() {
        std::thread::sleep(ASK_EVERY);
    }
}

/// The `ExitStatus` text for a clean exit.
///
/// A string because [`Exit`](domicile_launch::supervise::Exit) stores the
/// status as displayed, which tells signals apart from exit codes.
const CLEANLY: &str = "exit status: 0";

/// Serves the control socket on a thread, routing engine commands to `engine`.
///
/// A separate thread because the supervisor blocks on its children. A failed
/// connection is logged and skipped, so one bad client cannot stop the socket.
/// `serving` tracks the current shell; it is read before answering and written
/// only after the engine accepts a load, so the lock is never held across the
/// call.
fn answering(
    control: &Control,
    serving: Arc<Mutex<PathBuf>>,
    engine: PathBuf,
) -> Result<(), String> {
    let listener = control
        .listener()
        .map_err(|why| format!("cannot answer the control socket: {why}"))?;
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    if let Err(why) = answer_one(stream, ANSWER_WITHIN, &|line| {
                        answer(
                            line,
                            &shell(&serving),
                            &|root, module| load_the_shell(&engine, root, module, &serving),
                            &|url| {
                                open_url(&engine, url, ANSWER_WITHIN).map_err(|why| why.to_string())
                            },
                            &|file| {
                                screenshot(&engine, file, CAPTURE_WITHIN)
                                    .map_err(|why| why.to_string())
                            },
                        )
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

/// Watches the module config's directory and reloads on edits.
///
/// Re-evaluates into `evaluated`, which the compositor watches. With `shell`
/// (the served module and the engine socket), also rebuilds the config as the
/// shell and loads it.
fn watching_the_config(
    binary: &Path,
    config: &Path,
    evaluated: PathBuf,
    shell: Option<(Arc<Mutex<PathBuf>>, PathBuf)>,
) -> Result<config_watch::Watching, String> {
    let binary = binary.to_path_buf();
    let module_config = config.to_path_buf();
    config_watch::watch(&beside(config), Duration::from_millis(250), move || {
        let reloaded = reevaluated(&binary, &module_config, &evaluated).and_then(|()| {
            shell.as_ref().map_or(Ok(()), |(serving, engine)| {
                built(
                    &binary,
                    &["--entry".into(), module_config.clone().into_os_string()],
                )
                .and_then(as_shell)
                .and_then(|page| load_the_shell(engine, &page.root, &page.module, serving))
            })
        });
        match reloaded {
            Ok(()) => eprintln!("domicile: {} reloaded", module_config.display()),
            Err(why) => {
                eprintln!(
                    "domicile: {} did not reload, and the desk is as it was: {why}",
                    module_config.display()
                );
                say_on_the_desk(&module_config, &why);
            }
        }
    })
}

/// Reports a failed reload as a notification, since the user is not watching
/// the terminal.
fn say_on_the_desk(config: &Path, why: &str) {
    let name = config
        .file_name()
        .unwrap_or(config.as_os_str())
        .to_string_lossy();
    let said = notification::session_bus()
        .and_then(|bus| notification::notify(&bus, &format!("{name} did not reload"), why));
    if let Err(unsaid) = said {
        eprintln!("domicile: cannot say so on the desk: {unsaid}");
    }
}

/// Re-evaluates `config` into `evaluated` atomically, so the compositor never
/// reads a partial file.
fn reevaluated(binary: &Path, config: &Path, evaluated: &Path) -> Result<(), String> {
    let fresh = evaluated_json(binary, config)?;
    let staged = evaluated.with_extension("json.next");
    std::fs::copy(&fresh, &staged)
        .and_then(|_| std::fs::rename(&staged, evaluated))
        .map_err(|why| format!("cannot place the evaluated config: {why}"))
}

/// The module the desktop is currently serving.
fn shell(serving: &Mutex<PathBuf>) -> PathBuf {
    serving
        .lock()
        .expect("nothing panics holding which shell is served")
        .clone()
}

/// Sends `load_shell` to the engine and records the new shell.
///
/// `serving` is updated only after the engine accepts, since a refused load
/// leaves the old shell in place.
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

/// Waits for a milestone file, watching for exits and stop requests.
///
/// Checking for a stop here matters because startup can take a minute; see
/// [`reach`] for what an ignored Ctrl-C leaves on a tty.
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

/// The engine's broker socket, which must exist before the compositor starts.
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

/// The compositor's session document, written once it is ready to serve.
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

/// Registers the run's desktops as the graphical session; see
/// `domicile_launch::graphical_session`.
///
/// - Each desktop registers again (its display may differ), but the session
///   ends only once, when the run ends. Ending is irreversible, and a desktop
///   restarted while the session is shutting down would be refused.
/// - Only on the DRM platform. A nested desktop leaves this to its host.
/// - Best effort: without a systemd user manager or `domicile-session.target`,
///   the portal does not start and a warning is printed. If the launcher is
///   killed, its variables remain until the next session sets its own.
struct SaidSession {
    is_the_session: bool,
    manager: Mutex<Option<zbus::blocking::Connection>>,
}

impl SaidSession {
    fn new(platform: &str) -> Self {
        SaidSession {
            is_the_session: platform == "drm",
            manager: Mutex::new(None),
        }
    }

    /// Registers the desktop that just came up.
    fn say(&self, places: &Runtime) {
        if self.is_the_session {
            match Self::said(places) {
                Ok(manager) => {
                    *self.manager.lock().expect("nothing panics holding it") = Some(manager);
                }
                Err(why) => eprintln!(
                    "domicile: the user manager was not told this desktop is the session, so \
                     the portal will not start in it: {why}"
                ),
            }
        }
    }

    fn said(places: &Runtime) -> Result<zbus::blocking::Connection, String> {
        let at = places.session.display();
        let published = std::fs::read_to_string(&places.session)
            .map_err(|why| format!("cannot read {at}: {why}"))?;
        let session: Session = serde_json::from_str(&published)
            .map_err(|why| format!("{at} is not a session: {why}"))?;
        let manager = notification::session_bus().map_err(|why| why.to_string())?;
        graphical_session::begin(&manager, &session.wayland_display, &places.control)
            .map_err(|why| why.to_string())?;
        Ok(manager)
    }
}

impl Drop for SaidSession {
    fn drop(&mut self) {
        let manager = self.manager.get_mut().expect("nothing panics holding it");
        if let Some(manager) = manager {
            if let Err(why) = graphical_session::end(manager) {
                eprintln!("domicile: the user manager still holds this desktop's session: {why}");
            }
        }
    }
}

/// Links `domicile-xdg-open` as `xdg-open` in `shims`; see
/// `domicile_launch::xdg_open`.
///
/// A symlink, not a copy, so the program can find `domicile` next to its real
/// path.
fn shim_xdg_open(shims: &Path, program: &Path) -> Result<(), String> {
    std::fs::create_dir_all(shims)
        .map_err(|why| format!("cannot make {}: {why}", shims.display()))?;
    std::os::unix::fs::symlink(program, shims.join("xdg-open"))
        .map_err(|why| format!("cannot put xdg-open in {}: {why}", shims.display()))
}

/// The installation's `share` directory, which holds `domicile-mimeapps.list`
/// and the `domicile-open-url` desktop entry.
///
/// In a checkout it does not exist, and missing data directories are skipped.
fn data_of(browser: &Path) -> Result<PathBuf, String> {
    browser
        .parent()
        .and_then(Path::parent)
        .map(|installation| installation.join("share"))
        .ok_or_else(|| format!("{} is in no installation of its own", browser.display()))
}

/// Creates this run's directory under `XDG_RUNTIME_DIR` (mode 700), or the
/// temp directory as a fallback.
///
/// The temp directory is world-readable, so there the sockets' own permissions
/// protect them.
fn tempdir() -> std::io::Result<std::path::PathBuf> {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let mine = base.join(format!("domicile-{}", std::process::id()));
    std::fs::create_dir_all(&mine)?;
    Ok(mine)
}
