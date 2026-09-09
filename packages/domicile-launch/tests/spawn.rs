//! What each of the three is actually started with.

use std::path::{Path, PathBuf};

use domicile_launch::spawn::{bridge, compositor, engine, Runtime};

fn runtime() -> Runtime {
    Runtime {
        broker: PathBuf::from("/run/d/broker"),
        chrome_socket: PathBuf::from("/run/d/chrome.sock"),
        profile: PathBuf::from("/run/d/profile"),
    }
}

fn env_of(spawn: &domicile_launch::spawn::Spawn, name: &str) -> Option<String> {
    spawn
        .env
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.to_string_lossy().into_owned())
}

fn args_of(spawn: &domicile_launch::spawn::Spawn) -> Vec<String> {
    spawn
        .args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn the_bridge_is_told_the_module_and_the_socket() {
    let spawned = bridge(
        Path::new("/l/bridge"),
        Path::new("/d/dist/shell.js"),
        &runtime(),
    );
    assert_eq!(spawned.program, PathBuf::from("/l/bridge"));
    assert_eq!(
        env_of(&spawned, "DOMICILE_MODULE").unwrap(),
        "/d/dist/shell.js"
    );
    assert_eq!(
        env_of(&spawned, "DOMICILE_SOCKET").unwrap(),
        "/run/d/chrome.sock"
    );
}

#[test]
fn the_engine_is_a_desktop_rather_than_a_browser() {
    // `--app` because a desktop is not a browser looking at a page: without it
    // the window carries a tab strip, an address bar and a bookmarks row above
    // the shell's own chrome, and the browser's own keyboard shortcuts stay
    // bound where a shell wants to bind them.
    let spawned = engine(
        Path::new("/l/engine"),
        "http://localhost:41234/",
        "wayland",
        &runtime(),
        None,
    );
    assert_eq!(spawned.program, PathBuf::from("/l/engine/chrome"));
    let args = args_of(&spawned);
    assert!(
        args.contains(&"--app=http://localhost:41234/".to_string()),
        "{args:?}"
    );
    assert!(
        args.contains(&"--ozone-platform=wayland".to_string()),
        "{args:?}"
    );
    assert!(
        args.contains(&"--domicile-broker-socket=/run/d/broker".to_string()),
        "{args:?}"
    );
    assert!(
        args.contains(&"--user-data-dir=/run/d/profile".to_string()),
        "{args:?}"
    );
}

#[test]
fn the_sandbox_stays_on() {
    // It was `--no-sandbox` unconditionally, and that was wrong twice: it
    // turns off what stands between a page and the machine, and Chromium says
    // so in a yellow bar across the top of the desktop, which a user
    // reasonably reads as broken. A container that needs it says so itself.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        "http://x/",
        "wayland",
        &runtime(),
        None,
    ));
    assert!(!args.iter().any(|arg| arg.contains("sandbox")), "{args:?}");
    assert!(
        !args
            .iter()
            .any(|arg| arg.starts_with("--enable-blink-features")),
        "the feature is stable in the pinned engine, and any value of that flag \
         draws a second unsupported-flag bar: {args:?}"
    );
}

#[test]
fn a_machine_that_needs_more_flags_adds_its_own() {
    // Word-split, which is what an argument list in an environment variable
    // is for. Whatever a given machine needs is its business, and a list it
    // can extend is smaller than a flag per problem.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        "http://x/",
        "wayland",
        &runtime(),
        Some("--no-sandbox  --disable-gpu"),
    ));
    assert!(args.contains(&"--no-sandbox".to_string()), "{args:?}");
    assert!(args.contains(&"--disable-gpu".to_string()), "{args:?}");
    assert!(!args.iter().any(|arg| arg.is_empty()), "{args:?}");
}

#[test]
fn the_compositor_is_a_producer_to_the_engine() {
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        &runtime(),
        &|_| None,
    );
    let args = args_of(&spawned);
    assert_eq!(
        args,
        [
            "--chrome-socket",
            "/run/d/chrome.sock",
            "--session",
            "/run/d/chrome.sock.session",
            "--engine-socket",
            "/run/d/broker",
        ]
    );
    // The engine's own directory, so `libdomicile_engine.so` is loadable.
    assert!(
        env_of(&spawned, "LD_LIBRARY_PATH")
            .unwrap()
            .starts_with("/l/engine"),
        "{spawned:?}"
    );
}

#[test]
fn the_engines_libraries_go_in_front_of_whatever_was_there() {
    // Prepended rather than replacing: a machine with its own
    // `LD_LIBRARY_PATH` set is telling the compositor where to find something,
    // and dropping it swaps one missing library for another.
    let inherited = |name: &str| (name == "LD_LIBRARY_PATH").then(|| "/opt/lib".to_string());
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        &runtime(),
        &inherited,
    );
    assert_eq!(
        env_of(&spawned, "LD_LIBRARY_PATH").unwrap(),
        "/l/engine:/opt/lib"
    );
}

#[test]
fn the_compositor_is_given_a_log_level_it_can_be_debugged_at() {
    // The default a desktop is worth watching at, and an explicit `RUST_LOG`
    // wins: somebody who set it is asking for something else.
    let quiet = compositor(
        Path::new("/b/c"),
        Path::new("/l/engine"),
        &runtime(),
        &|_| None,
    );
    assert_eq!(
        env_of(&quiet, "RUST_LOG").unwrap(),
        "info,domicile_compositor=debug"
    );

    let asked = |name: &str| (name == "RUST_LOG").then(|| "warn".to_string());
    let spawned = compositor(
        Path::new("/b/c"),
        Path::new("/l/engine"),
        &runtime(),
        &asked,
    );
    assert_eq!(env_of(&spawned, "RUST_LOG").unwrap(), "warn");
}
