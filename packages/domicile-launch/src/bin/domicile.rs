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
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use domicile_launch::address::url_for;
use domicile_launch::apps::list_the_settings_host;
use domicile_launch::build_progress::{bar, heard, Heard as BuilderHeard, Step};
use domicile_launch::cli::{invocation, CliError, Invocation};
use domicile_launch::command_socket::{
    load_shell, open_url, set_site_permission, site_permissions,
};
use domicile_launch::components::{apps, builder, components, our_shell, Components};
use domicile_launch::compositor_socket::{screenshot, send_shell};
use domicile_launch::config_check::check;
use domicile_launch::config_path::{config_file, is_module, ConfigFile};
use domicile_launch::config_watch;
use domicile_launch::control::{
    answer, Desktop as ControlDesktop, Request, Response, SettingsFiles,
};
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
    clear_the_last_engine, clear_the_last_one, keep_a_desktop_up, keep_the_engine_up,
    restarts_the_engine, Attempt, Ending, Policy, CLEANLY,
};
use domicile_launch::session::Session;
use domicile_launch::shell_path::Shell;
use domicile_launch::shell_source::{shell_source, ShellSource};
use domicile_launch::spawn::{compositor, engine, Runtime};
use domicile_launch::splash::{lay_out, tell, when_the_engine_answers, Progress};
use domicile_launch::supervise::{catch_interrupts, interrupted, Running, ASK_EVERY};

/// How long each startup milestone may take. A debug build on a loaded
/// machine takes seconds.
const PATIENCE: Duration = Duration::from_secs(30);

/// How long a screenshot may take: the compositor reads back every monitor
/// and encodes a PNG, which for several 4K monitors takes seconds.
const CAPTURE_WITHIN: Duration = Duration::from_secs(10);

/// How long the compositor may take to send a shell command. Shorter than the
/// client waits for the supervisor, so the compositor's failure reaches the
/// terminal rather than a timeout.
const SEND_WITHIN: Duration = Duration::from_secs(2);

/// How long a first build may take before the splash shows. A cached build
/// answers well within it, so the desk starts on its shell.
const SPLASH_AFTER: Duration = Duration::from_millis(500);

/// How long the splash plays its ending before the built shell replaces it.
/// Matches `ENDING_MS` in `packages/shell-splash`.
const SPLASH_ENDING: Duration = Duration::from_millis(900);

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
        // Absolute here, since the compositor does not share this working
        // directory.
        Invocation::Screenshot { file } => asked(&Request::Screenshot {
            file: file
                .map(|file| {
                    std::path::absolute(&file)
                        .map_err(|why| format!("cannot tell where {file} is: {why}"))
                })
                .transpose()?,
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
    match wanted(shell, handed_in, from)? {
        Wanted::Ready(page) | Wanted::Ours(page) => Ok(page),
        Wanted::Built(asked) => built(&myself()?, &asked, &mut |_| {}).and_then(as_shell),
    }
}

/// A shell to serve as it is, or the builder arguments that make one.
enum Wanted {
    Ready(Shell),
    /// One of Domicile's prebuilt shells, which has no source to edit.
    Ours(Shell),
    Built(Vec<std::ffi::OsString>),
}

impl Wanted {
    /// The file the shell is written in, which the Settings app edits: a
    /// module served as is, or an entry the builder builds. A package has
    /// none.
    fn source(&self) -> Option<PathBuf> {
        match self {
            Wanted::Ready(page) => Some(page.root.join(&page.module)),
            Wanted::Ours(_) => None,
            Wanted::Built(asked) => match asked.as_slice() {
                [flag, entry] if flag == "--entry" => Some(PathBuf::from(entry)),
                _ => None,
            },
        }
    }
}

/// What `shell` needs before it can be served; see [`shell_named`].
fn wanted(shell: &str, handed_in: Option<&str>, from: Option<&Path>) -> Result<Wanted, String> {
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
    match source {
        ShellSource::Module(page) => Ok(Wanted::Ready(page)),
        // Prebuilt in the install, so no build is needed.
        ShellSource::Ours(name) => our_shell(&myself()?, &name, &env, &|path| path.exists())
            .map(|root| {
                Wanted::Ours(Shell {
                    root,
                    module: PathBuf::from("shell.js"),
                })
            })
            .map_err(|missing| missing.to_string()),
        ShellSource::Entry(entry) => Ok(Wanted::Built(vec![
            "--entry".into(),
            entry.into_os_string(),
        ])),
        ShellSource::Package(spec) => Ok(Wanted::Built(vec!["--package".into(), spec.into()])),
    }
}

/// This binary, which the other components are found beside.
fn myself() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|why| format!("cannot find myself: {why}"))
}

/// Runs the shell builder and returns its final result, showing progress.
///
/// On a terminal the bar redraws in place; otherwise each step is one line.
/// Each step also goes to `stepped`. Build log lines are printed only if the
/// build fails.
fn built(
    binary: &Path,
    asked: &[std::ffi::OsString],
    stepped: &mut dyn FnMut(&Step),
) -> Result<BuilderHeard, String> {
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
                stepped(&step);
            }
            BuilderHeard::Step(step) => {
                eprintln!("domicile: {}", bar(&step));
                stepped(&step);
            }
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
        &mut |_| {},
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
        // Longer than the supervisor waits for the compositor, so the
        // compositor's own failure reaches this terminal rather than a timeout.
        Request::Screenshot { file: Some(_) } => Some(CAPTURE_WITHIN + ANSWER_WITHIN),
        // The user picks the area, however long that takes. A desktop that
        // dies hangs up, which ends the wait.
        Request::Screenshot { file: None } => None,
        _ => Some(ANSWER_WITHIN),
    };
    let answer = ask(&socket, request, patience).map_err(|why| why.to_string())?;
    match answer {
        Response::Shell { module } => {
            println!("{}", module.display());
            Ok(ExitCode::SUCCESS)
        }
        Response::Opened | Response::Sent => Ok(ExitCode::SUCCESS),
        Response::Captured { file } => {
            println!("{}", file.display());
            Ok(ExitCode::SUCCESS)
        }
        // A failure, so `f=$(domicile screenshot) && …` stops here.
        Response::Canceled => {
            eprintln!("domicile: the screenshot was canceled");
            Ok(ExitCode::FAILURE)
        }
        // Only `domicile-settings-host` asks for these.
        Response::SettingsFiles { .. } | Response::SitePermissions(_) | Response::Stored => Err(
            format!("the desktop answered {answer:?}, which no command asks for"),
        ),
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
    // Domicile's own apps, such as History, which every desktop installs.
    let apps = apps(&binary, &env, &|path| path.exists());

    // `DOMICILE_PAGE` names the module like the argument does, for packaged
    // desktops.
    let wanted = match (shell, named) {
        (Some(shell), _) => wanted(shell, env("DOMICILE_PAGE").as_deref(), None)?,
        (None, Some((named, from))) => wanted(&named, None, Some(&from))?,
        (None, None) => return Err(CliError::NoShell.to_string()),
    };

    // The profile persists across runs to keep sign-ins. Fail rather than
    // guess a location, so the user can always find and delete it.
    let kept = profile_directory(&env)
        .ok_or("nowhere to keep the engine's profile -- neither XDG_STATE_HOME nor HOME is set")?;
    // Held for the whole run: two engines cannot share a profile.
    let profile = claim(&kept)
        .map_err(|why| format!("cannot claim a profile beside {}: {why}", kept.display()))?;

    // Lets the Settings app start its host, which ships beside this binary.
    let settings_host = binary.with_file_name("domicile-settings-host");
    match settings_host.exists() {
        true => list_the_settings_host(&profile.path, &settings_host).map_err(|why| {
            format!(
                "cannot list the Settings app's host in {}: {why}",
                profile.path.display()
            )
        })?,
        false => println!(
            "settings: no {} beside domicile, so the Settings app cannot read the config",
            settings_host.display()
        ),
    }

    // A per-run directory for sockets, so concurrent desktops do not collide.
    let runtime = tempdir().map_err(|why| format!("no runtime directory: {why}"))?;

    // What the Settings app edits. A module config is evaluated to
    // `config.json` in the runtime directory, below.
    let files = SettingsFiles {
        config: config.path().map(Path::to_path_buf),
        evaluated: config
            .path()
            .is_some_and(is_module)
            .then(|| runtime.join("config.json")),
        shell: wanted.source(),
    };

    // A shell that builds quickly is built before anything starts, so a broken
    // one starts nothing. A slower build continues behind the splash.
    let splash = runtime.join("splash");
    let (page, building) = match wanted {
        Wanted::Ready(page) | Wanted::Ours(page) => (page, None),
        Wanted::Built(asked) => first_build(&binary, asked, &splash)?,
    };
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
    // supervisor owns it because it routes commands to the engine and the
    // compositor, and it is keyed on the pid because no Wayland display exists
    // yet.
    let control = take(&places.control).map_err(|why| why.to_string())?;
    let serving = Arc::new(Mutex::new(page));
    answering(
        &control,
        Arc::clone(&serving),
        files,
        places.command.clone(),
        places.chrome_socket.clone(),
    )?;
    println!("{VARIABLE}={}", places.control.display());
    if let Some(building) = building {
        replacing_the_splash(
            building,
            splash,
            Arc::clone(&serving),
            places.command.clone(),
        );
    }

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
        apps: apps.as_deref(),
        browser: &browser,
        components: &components,
        config: compositor_config.as_deref(),
        env: &env,
        places: &places,
        platform: &platform,
        policy: &policy,
        said: &said,
        serving: &serving,
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
    apps: Option<&'a Path>,
    browser: &'a Path,
    components: &'a Components,
    config: Option<&'a Path>,
    env: &'a dyn Fn(&str) -> Option<String>,
    places: &'a Runtime,
    platform: &'a str,
    /// The restart policy, shared by the engine and desktop loops. Each loop
    /// counts its own failures.
    policy: &'a Policy,
    /// The graphical session registration, renewed by each desktop.
    said: &'a SaidSession,
    /// The shell the engine serves, which a new engine starts on.
    serving: &'a Mutex<Shell>,
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
                desktop.apps,
                desktop.places,
                desktop.config,
                desktop.said.scope_clients,
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
    match restarts_the_engine(&exit, desktop.platform) {
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
                // Said here, since ending the run cleanly prints nothing else.
                true => {
                    eprintln!("domicile: {exit}");
                    Ok(())
                }
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
                &served(desktop.serving),
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

/// Serves the control socket on a thread, routing engine commands to `engine`
/// and screenshots and shell commands to the compositor's `chrome` socket.
///
/// A separate thread because the supervisor blocks on its children, and a
/// thread per connection because an interactive screenshot waits on the user.
/// A failed connection is logged and skipped, so one bad client cannot stop
/// the socket. `serving` tracks the current shell; see [`load_the_shell`].
fn answering(
    control: &Control,
    serving: Arc<Mutex<Shell>>,
    files: SettingsFiles,
    engine: PathBuf,
    chrome: PathBuf,
) -> Result<(), String> {
    let listener = control
        .listener()
        .map_err(|why| format!("cannot answer the control socket: {why}"))?;
    let (files, engine, chrome) = (Arc::new(files), Arc::new(engine), Arc::new(chrome));
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    let (serving, files, engine, chrome) = (
                        serving.clone(),
                        files.clone(),
                        engine.clone(),
                        chrome.clone(),
                    );
                    std::thread::spawn(move || {
                        answer_a_command(stream, &serving, &files, &engine, &chrome)
                    });
                }
                Err(why) => eprintln!("domicile: a command did not arrive: {why}"),
            }
        }
    });
    Ok(())
}

/// Answers the one command on `stream`; see [`answering`].
fn answer_a_command(
    stream: UnixStream,
    serving: &Mutex<Shell>,
    files: &SettingsFiles,
    engine: &Path,
    chrome: &Path,
) {
    if let Err(why) = answer_one(stream, ANSWER_WITHIN, &|line| {
        let page = served(serving);
        answer(
            line,
            &ControlDesktop {
                module: &page.root.join(&page.module),
                files,
                load: &|root, module| load_the_shell(engine, root, module, serving),
                open: &|url| open_url(engine, url, ANSWER_WITHIN).map_err(|why| why.to_string()),
                // The interactive one waits for the user, however long that
                // takes.
                capture: &|file| {
                    screenshot(chrome, file, file.map(|_| CAPTURE_WITHIN))
                        .map_err(|why| why.to_string())
                },
                permissions: &|| {
                    site_permissions(engine, ANSWER_WITHIN).map_err(|why| why.to_string())
                },
                set_permission: &|site| {
                    set_site_permission(engine, site, ANSWER_WITHIN).map_err(|why| why.to_string())
                },
                send: &|command| {
                    send_shell(chrome, command, Some(SEND_WITHIN)).map_err(|why| why.to_string())
                },
            },
        )
    }) {
        eprintln!("domicile: a command went unanswered: {why}");
    }
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
    shell: Option<(Arc<Mutex<Shell>>, PathBuf)>,
) -> Result<config_watch::Watching, String> {
    let binary = binary.to_path_buf();
    let module_config = config.to_path_buf();
    config_watch::watch(&beside(config), Duration::from_millis(250), move || {
        let reloaded = reevaluated(&binary, &module_config, &evaluated).and_then(|()| {
            shell.as_ref().map_or(Ok(()), |(serving, engine)| {
                built(
                    &binary,
                    &["--entry".into(), module_config.clone().into_os_string()],
                    &mut |_| {},
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

/// The shell the desktop is currently serving.
fn served(serving: &Mutex<Shell>) -> Shell {
    serving
        .lock()
        .expect("nothing panics holding which shell is served")
        .clone()
}

/// Sends `load_shell` to the engine and records the new shell.
///
/// `serving` is updated only after the engine accepts, since a refused load
/// leaves the old shell in place. Its lock is held across the call, so loads
/// from concurrent commands and the config watcher record the shell the
/// engine took last.
fn load_the_shell(
    engine: &Path,
    root: &Path,
    module: &Path,
    serving: &Mutex<Shell>,
) -> Result<(), String> {
    let mut served = serving
        .lock()
        .expect("nothing panics holding which shell is served");
    load_shell(engine, root, module, ANSWER_WITHIN).map_err(|why| why.to_string())?;
    *served = Shell {
        module: module.to_path_buf(),
        root: root.to_path_buf(),
    };
    Ok(())
}

/// A built shell, or why it did not build.
type Building = Receiver<Result<Shell, String>>;

/// Starts the first build of the shell and waits [`SPLASH_AFTER`] for it.
///
/// Returns the built shell, or, while the build continues, the splash laid out
/// in `splash` and the build to wait on. Each step is told to the splash.
fn first_build(
    binary: &Path,
    asked: Vec<std::ffi::OsString>,
    splash: &Path,
) -> Result<(Shell, Option<Building>), String> {
    std::fs::create_dir_all(splash)
        .and_then(|()| tell(splash, &Progress::Starting))
        .map_err(|why| format!("cannot make the splash at {}: {why}", splash.display()))?;
    let (answer, building) = channel();
    let (builder_of, told) = (binary.to_path_buf(), splash.to_path_buf());
    std::thread::spawn(move || {
        let page = built(&builder_of, &asked, &mut |step| {
            if let Err(why) = tell(&told, &Progress::from(step)) {
                eprintln!("domicile: the splash missed a step: {why}");
            }
        })
        .and_then(as_shell);
        // The receiver is gone only if the run ended, and then nobody waits.
        let _ = answer.send(page);
    });
    match building.recv_timeout(SPLASH_AFTER) {
        Ok(page) => page.map(|page| (page, None)),
        Err(_) => {
            let env = |name: &str| std::env::var(name).ok();
            let bundle = our_shell(binary, "splash", &env, &|path| path.exists())
                .map_err(|missing| missing.to_string())?;
            let page = lay_out(&bundle, splash)
                .map_err(|why| format!("cannot lay out the splash: {why}"))?;
            println!("the shell is still building, so the desk starts on the splash");
            Ok((page, Some(building)))
        }
    }
}

/// Loads the shell `building` makes in place of the splash, on a thread.
///
/// The splash plays its ending first. A failed build or load stays on the
/// splash, which shows why and logs out on a key.
fn replacing_the_splash(
    building: Building,
    splash: PathBuf,
    serving: Arc<Mutex<Shell>>,
    engine: PathBuf,
) {
    std::thread::spawn(move || {
        let loaded = building
            .recv()
            .unwrap_or_else(|_| Err("the shell builder's thread ended without an answer".into()))
            .and_then(|page| {
                if let Err(why) = tell(&splash, &Progress::Built) {
                    eprintln!("domicile: the splash missed its ending: {why}");
                }
                std::thread::sleep(SPLASH_ENDING);
                let asked = Instant::now();
                when_the_engine_answers(
                    &mut || {
                        let mut served = serving
                            .lock()
                            .expect("nothing panics holding which shell is served");
                        load_shell(&engine, &page.root, &page.module, ANSWER_WITHIN)?;
                        *served = page.clone();
                        Ok(())
                    },
                    // The engine has its own milestone to start within.
                    &|| interrupted() || asked.elapsed() > 2 * PATIENCE,
                    &mut || std::thread::sleep(ASK_EVERY),
                )
                .map(|()| page.root.join(&page.module))
                .map_err(|why| why.to_string())
            });
        match loaded {
            Ok(module) => println!("the splash gave way to {}", module.display()),
            Err(why) => {
                eprintln!("domicile: the desk stays on the splash: {why}");
                let failed = Progress::Failed {
                    supervisor: std::process::id(),
                    // `built` ends a failure with the build log, often empty.
                    why: why.trim_end(),
                };
                if let Err(unsaid) = tell(&splash, &failed) {
                    eprintln!("domicile: the splash cannot say so: {unsaid}");
                }
            }
        }
    });
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
/// - Clients get their own scopes only when a user manager answers, since
///   `systemd-run --user` fails without one and no app would start.
struct SaidSession {
    is_the_session: bool,
    scope_clients: bool,
    manager: Mutex<Option<zbus::blocking::Connection>>,
}

impl SaidSession {
    /// Names the desktop to the user manager when it is the session, before
    /// any component starts; see `graphical_session::name`.
    fn new(platform: &str) -> Self {
        let is_the_session = platform == "drm";
        SaidSession {
            is_the_session,
            scope_clients: is_the_session && Self::a_user_manager_answers(),
            manager: Mutex::new(is_the_session.then(Self::named).flatten()),
        }
    }

    /// Exports the desktop's name. Says why on stderr when it cannot.
    fn named() -> Option<zbus::blocking::Connection> {
        let named = notification::session_bus().and_then(|manager| {
            graphical_session::name(&manager)?;
            Ok(manager)
        });
        match named {
            Ok(manager) => Some(manager),
            Err(why) => {
                eprintln!(
                    "domicile: the user manager was not told this desktop's name before the \
                     desktop started: {why}"
                );
                None
            }
        }
    }

    /// Whether `org.freedesktop.systemd1` is on the session bus. Says why on
    /// stderr when not.
    fn a_user_manager_answers() -> bool {
        let answered = notification::session_bus().and_then(|bus| {
            zbus::blocking::fdo::DBusProxy::new(&bus)?
                .name_has_owner("org.freedesktop.systemd1".try_into()?)
                .map_err(zbus::Error::from)
        });
        match answered {
            Ok(true) => true,
            Ok(false) => {
                eprintln!(
                    "domicile: no systemd user manager is on the session bus, so apps share the \
                     desktop's cgroup"
                );
                false
            }
            Err(why) => {
                eprintln!(
                    "domicile: the session bus did not say whether a user manager runs, so apps \
                     share the desktop's cgroup: {why}"
                );
                false
            }
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
