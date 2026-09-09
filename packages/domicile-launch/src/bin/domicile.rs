//! `domicile ./my-desktop/dist/shell.js` — a desktop, in one command.
//!
//! Everything with a decision in it is a module of `domicile_launch` with
//! tests of its own; this is the part that reads the world and starts things.
//! It is deliberately short, because it is the part nothing can test: no CI
//! runner has a display, and the shell script it replaces was not run by
//! anything either.

use std::process::ExitCode;
use std::time::Duration;

use domicile_launch::cli::{invocation, Invocation};
use domicile_launch::components::components;
use domicile_launch::platform::platform;
use domicile_launch::shell_path::shell_page;
use domicile_launch::spawn::{compositor, engine, Runtime};
use domicile_launch::supervise::{wait_for_broker, Running};

/// How long the engine gets to open its broker socket. A debug build on a
/// loaded machine is seconds, not milliseconds.
const BROKER_PATIENCE: Duration = Duration::from_secs(30);

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

    let page = shell_page(&shell, env("DOMICILE_PAGE").as_deref(), &|path| {
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
    };

    // What was chosen, before anything is started: a failure below is about
    // this shell, and naming it after the failure is too late to be read.
    println!("shell: {}", page.display());
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
    wait_for_broker(&places.broker, BROKER_PATIENCE).map_err(|why| why.to_string())?;

    running
        .start(
            "compositor",
            &compositor(&components.compositor, &components.engine, &places, &env),
        )
        .map_err(|why| why.to_string())?;

    println!();
    println!("domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above.");
    println!("Ctrl-C to stop.");
    let status = running
        .wait_for_the_desktop()
        .map_err(|why| format!("the compositor could not be waited on: {why}"))?;
    Ok(match status.success() {
        true => ExitCode::SUCCESS,
        false => ExitCode::FAILURE,
    })
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
