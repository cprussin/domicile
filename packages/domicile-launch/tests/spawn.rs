//! The command lines and environments the launcher starts each component with.

use std::path::{Path, PathBuf};

use domicile_launch::shell_path::Shell;
use domicile_launch::spawn::{compositor, engine, Runtime};

/// A built shell, split as `shell_path` returns it: the directory the engine
/// serves and the module the generated document loads.
///
/// The module is `main.js` so nothing here relies on the `shell.js` build
/// convention.
fn shell() -> Shell {
    Shell {
        root: PathBuf::from("/d/dist"),
        module: PathBuf::from("main.js"),
    }
}

/// The session path is passed explicitly, not derived from the chrome socket,
/// because the launcher waits for the compositor to publish it.
fn runtime() -> Runtime {
    Runtime {
        broker: PathBuf::from("/run/d/broker"),
        chrome_socket: PathBuf::from("/run/d/chrome.sock"),
        command: PathBuf::from("/run/d/command.sock"),
        control: PathBuf::from("/run/d/domicile-ipc.4242.sock"),
        profile: PathBuf::from("/run/d/profile"),
        shims: PathBuf::from("/run/d/bin"),
        session: PathBuf::from("/run/d/session.json"),
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
fn the_engine_is_a_desktop_rather_than_a_browser() {
    // `--app` removes the tab strip, address bar and bookmarks row, and frees
    // the browser's keyboard shortcuts for the shell.
    let spawned = engine(
        Path::new("/l/engine"),
        &shell(),
        "wayland",
        &runtime(),
        None,
    );
    assert_eq!(spawned.program, PathBuf::from("/l/engine/chrome"));
    let args = args_of(&spawned);
    // The whole string, with no trailing path. `CreateLoaderAndStart` serves
    // the generated document only for `/`; any other path goes to the file
    // resolver, finds nothing and leaves an empty window.
    assert!(
        args.contains(&"--app=domicile://shell/".to_string()),
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
fn the_engine_takes_commands_on_a_socket_of_this_runs_own() {
    // Without this switch `domicile load-shell` has nowhere to send
    // `load_shell`, and the shell cannot be replaced.
    //
    // The socket is in the run directory, not at `control_socket::address`,
    // because only the supervisor dials it, like the broker and chrome sockets.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
        "wayland",
        &runtime(),
        None,
    ));
    assert!(
        args.contains(&"--domicile-command-socket=/run/d/command.sock".to_string()),
        "{args:?}"
    );
}

#[test]
fn a_tty_desktop_asks_for_the_whole_screen() {
    // Without this the screen stays black with no error. ozone/drm binds a
    // window to a CRTC only when their rects match exactly
    // (`ScreenManager::FindWindowAt`). Chromium's default window is inset and
    // narrower, so no controller is bound and every page flip is dropped.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
        "drm",
        &runtime(),
        None,
    ));
    assert!(args.contains(&"--start-fullscreen".to_string()), "{args:?}");
}

#[test]
fn the_desk_is_given_tile_memory_for_every_monitor() {
    // OVER BUDGET, THE SHELL'S CHROME BLINKS. Chromium sizes a page's tile
    // memory from the screen it first sees -- one monitor -- and a desk page
    // spans all of them, each at its own density. Short of memory, the tiles
    // a frame needs are marked out of memory and drawn as flat color until
    // their turn comes round again: bars and panels redrawing in bands, while
    // a webview or an app, which are surfaces of their own, look fine.
    for platform in ["drm", "wayland"] {
        let args = args_of(&engine(
            Path::new("/l/engine"),
            &shell(),
            platform,
            &runtime(),
            None,
        ));
        let budget = args
            .iter()
            .find_map(|arg| arg.strip_prefix("--force-gpu-mem-available-mb="))
            .and_then(|mb| mb.parse::<u32>().ok());
        assert!(budget.is_some_and(|mb| mb >= 2048), "{platform}: {args:?}");
    }
}

#[test]
fn a_nested_desktop_does_not_take_over_the_screen() {
    // A nested run is a window in someone else's session, so it must not go
    // fullscreen.
    for platform in ["wayland", "headless"] {
        let args = args_of(&engine(
            Path::new("/l/engine"),
            &shell(),
            platform,
            &runtime(),
            None,
        ));
        assert!(
            !args.contains(&"--start-fullscreen".to_string()),
            "{platform}: {args:?}"
        );
    }
}

#[test]
fn a_nested_desktop_asks_the_host_compositor_to_stop_reading_the_keyboard() {
    // Without this a nested desktop gets no Meta chords, because the host
    // compositor takes them first. sway stops when a client asks
    // (`shortcuts_inhibitor enable`), so the engine asks. Otherwise
    // `grabShortcut` bindings cannot be tested nested.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
        "wayland",
        &runtime(),
        None,
    ));
    assert!(
        args.contains(&"--domicile-inhibit-host-shortcuts".to_string()),
        "{args:?}"
    );
}

#[test]
fn a_desktop_with_no_host_compositor_has_nothing_to_inhibit() {
    // On `drm` the desktop is the compositor, and on `headless` there is no
    // host session, so there is nobody to ask.
    for platform in ["drm", "headless"] {
        let args = args_of(&engine(
            Path::new("/l/engine"),
            &shell(),
            platform,
            &runtime(),
            None,
        ));
        assert!(
            !args.contains(&"--domicile-inhibit-host-shortcuts".to_string()),
            "{platform}: {args:?}"
        );
    }
}

#[test]
fn the_engine_is_told_where_the_shell_is_and_where_the_compositor_is() {
    // The engine reads the shell's files itself and dials the compositor's
    // socket. Missing any of these three flags starts a desktop that shows
    // nothing, so each is asserted.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
        "wayland",
        &runtime(),
        None,
    ));
    assert!(
        args.contains(&"--domicile-shell-root=/d/dist".to_string()),
        "{args:?}"
    );
    // Relative: it becomes a `<script src>` resolved against
    // `domicile://shell/`, where an absolute path would not resolve.
    //
    // It is the module the user named, not a fixed `shell.js`.
    assert!(
        args.contains(&"--domicile-shell-module=main.js".to_string()),
        "{args:?}"
    );
    assert!(
        args.contains(&"--domicile-control-socket=/run/d/chrome.sock".to_string()),
        "{args:?}"
    );
}

#[test]
fn no_page_is_served_over_a_port() {
    // A page served on a host and port would be reachable by every process on
    // the machine.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
        "wayland",
        &runtime(),
        None,
    ));
    assert!(
        !args
            .iter()
            .any(|arg| arg.contains("http://") || arg.contains("localhost")),
        "{args:?}"
    );
}

#[test]
fn the_sandbox_stays_on() {
    // `--no-sandbox` removes the isolation between a page and the machine, and
    // Chromium shows a warning bar for it. A container that needs it adds it as
    // an extra flag.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
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
    // Extra flags come from an environment variable, split on whitespace, so a
    // machine can add what it needs without a flag per problem.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
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
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &|_| None,
    );
    let args = args_of(&spawned);
    assert_eq!(
        args,
        [
            "--chrome-socket",
            "/run/d/chrome.sock",
            "--session",
            "/run/d/session.json",
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
fn the_compositor_carries_this_desktops_control_socket_to_everything_it_starts() {
    // A terminal opened inside this desktop finds it through this variable,
    // since every app inherits the compositor's environment.
    //
    // It is set on the compositor, not exported by the supervisor, because a
    // supervisor started inside another desktop would pass on that desktop's
    // socket.
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &|_| None,
    );
    assert_eq!(
        env_of(&spawned, "DOMICILE_SOCK").unwrap(),
        "/run/d/domicile-ipc.4242.sock"
    );
}

#[test]
fn a_link_an_app_opens_opens_in_this_desktop() {
    // Programs run `BROWSER` to open a link, and every app inherits the
    // compositor's environment, so links open in this desktop.
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &|_| None,
    );
    assert_eq!(env_of(&spawned, "BROWSER").unwrap(), "/b/domicile-open-url");
}

#[test]
fn xdg_open_is_this_desktops_for_every_app_it_starts() {
    // The shim directory goes first on `PATH`, so `xdg-open` opens links in
    // this desktop whatever `mimeapps.list` says. The rest of the path still
    // resolves.
    let inherited = |name: &str| (name == "PATH").then(|| "/usr/bin:/bin".to_string());
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &inherited,
    );
    assert_eq!(
        env_of(&spawned, "PATH").unwrap(),
        "/run/d/bin:/usr/bin:/bin"
    );
}

#[test]
fn a_link_an_app_opens_through_gio_or_a_portal_opens_in_this_desktop_too() {
    // GIO and the portal skip `xdg-open` and read `domicile-mimeapps.list` from
    // the data directories, since `XDG_CURRENT_DESKTOP` is `domicile`. The
    // desktop's `share` holds that file and its `domicile-open-url` entry, so
    // it goes first, with no file in the user's home.
    let inherited = |name: &str| (name == "XDG_DATA_DIRS").then(|| "/run/sw/share".to_string());
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &inherited,
    );
    assert_eq!(
        env_of(&spawned, "XDG_DATA_DIRS").unwrap(),
        "/d/share:/run/sw/share"
    );
}

#[test]
fn a_machine_with_no_data_directories_keeps_the_defaults_behind_this_desktops() {
    // Unset means `/usr/local/share:/usr/share`, so those defaults stay after
    // this desktop's directory.
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &|_| None,
    );
    assert_eq!(
        env_of(&spawned, "XDG_DATA_DIRS").unwrap(),
        "/d/share:/usr/local/share:/usr/share"
    );
}

#[test]
fn the_engines_libraries_go_in_front_of_whatever_was_there() {
    // Prepended: an existing `LD_LIBRARY_PATH` points at libraries the machine
    // needs.
    let inherited = |name: &str| (name == "LD_LIBRARY_PATH").then(|| "/opt/lib".to_string());
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &inherited,
    );
    assert_eq!(
        env_of(&spawned, "LD_LIBRARY_PATH").unwrap(),
        "/l/engine:/opt/lib"
    );
}

#[test]
fn the_compositor_is_quiet_unless_asked_otherwise() {
    // The default shows warnings plus the compositor's few `INFO` lines a
    // person acts on. An explicit `RUST_LOG` wins.
    let quiet = compositor(
        Path::new("/b/c"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &|_| None,
    );
    assert_eq!(
        env_of(&quiet, "RUST_LOG").unwrap(),
        "warn,domicile_compositor=info,domicile=info"
    );

    let asked = |name: &str| (name == "RUST_LOG").then(|| "warn".to_string());
    let spawned = compositor(
        Path::new("/b/c"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &asked,
    );
    assert_eq!(env_of(&spawned, "RUST_LOG").unwrap(), "warn");
}

#[test]
fn the_engine_is_asked_to_say_what_it_did_about_input() {
    // A release build without `--enable-logging` prints only ERROR and above to
    // stderr (`base/logging.cc`). The fork logs input failures, such as a
    // revoked device or a console taken back, at ERROR, so these flags make
    // them visible. The level stays at ERROR because upstream logs a dozen
    // routine WARNINGs on a nested run. Nested runs use the same engine, so
    // they get the same flags.
    for platform in ["drm", "wayland", "headless"] {
        let args = args_of(&engine(
            Path::new("/l/engine"),
            &shell(),
            platform,
            &runtime(),
            None,
        ));
        assert!(
            args.contains(&"--enable-logging=stderr".to_string()),
            "{platform}: {args:?}"
        );
        assert!(
            args.contains(&"--log-level=2".to_string()),
            "{platform}: {args:?}"
        );
    }
}

#[test]
fn a_run_that_wants_more_than_errors_can_ask_for_them() {
    // The default is a floor. `extra` comes after the built list, and
    // `CommandLine::AppendSwitchNative` keeps the last value of a switch, so a
    // run can ask for INFO through `extra`.
    let args = args_of(&engine(
        Path::new("/l/engine"),
        &shell(),
        "drm",
        &runtime(),
        Some("--log-level=0"),
    ));
    let levels: Vec<&String> = args
        .iter()
        .filter(|arg| arg.starts_with("--log-level="))
        .collect();
    assert_eq!(levels, vec!["--log-level=2", "--log-level=0"], "{args:?}");
}

#[test]
fn the_engine_is_told_a_touchpad_is_libinputs() {
    // Without this the pointer draws but a touchpad never moves it.
    // `CreateConverter` has a touchpad branch only under `USE_EVDEV_GESTURES`
    // (ChromeOS devices). Other pads fall through to `EventConverterEvdevImpl`,
    // which ignores `EV_ABS`, so every finger position is dropped silently.
    //
    // `EventDeviceInfo::UseLibinput` honors an overridden
    // `kLibinputHandleTouchpad`, which is disabled by default, so the override
    // is required. Patch 0027 lets libinput read a descriptor it cannot open
    // itself.
    //
    // Set on every platform so a developer's touchpad behaves the same nested.
    for platform in ["drm", "wayland", "headless"] {
        let args = args_of(&engine(
            Path::new("/l/engine"),
            &shell(),
            platform,
            &runtime(),
            None,
        ));
        assert!(
            features_of(&args).contains(&"LibinputHandleTouchpad"),
            "{platform}: {args:?}"
        );
    }
}

#[test]
fn the_engine_is_told_a_mouse_is_libinputs() {
    // `EventConverterEvdevImpl` reads mouse motion raw, with no acceleration,
    // and ignores `REL_WHEEL`. `kLibinputHandleMouse` (patch 0059) is off
    // unless overridden.
    for platform in ["drm", "wayland", "headless"] {
        let args = args_of(&engine(
            Path::new("/l/engine"),
            &shell(),
            platform,
            &runtime(),
            None,
        ));
        assert!(
            features_of(&args).contains(&"LibinputHandleMouse"),
            "{platform}: {args:?}"
        );
    }
}

/// The features in the single `--enable-features` flag. A second flag would
/// replace the first.
fn features_of(args: &[String]) -> Vec<&str> {
    let lists: Vec<&str> = args
        .iter()
        .filter_map(|arg| arg.strip_prefix("--enable-features="))
        .collect();
    assert_eq!(lists.len(), 1, "{args:?}");
    lists[0].split(',').collect()
}

#[test]
fn the_compositor_is_given_the_config_it_was_started_with() {
    // The monitors, their scales and rotations are in this file, and the
    // compositor is the process that reads it.
    let spawned = compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        Some(Path::new("/etc/domicile/desk.json")),
        &|_| None,
    );
    let args = args_of(&spawned);
    assert_eq!(
        args,
        [
            "--chrome-socket",
            "/run/d/chrome.sock",
            "--session",
            "/run/d/session.json",
            "--engine-socket",
            "/run/d/broker",
            "--config",
            "/etc/domicile/desk.json",
        ]
    );
}

#[test]
fn a_desktop_with_no_config_is_given_no_flag_rather_than_an_empty_one() {
    // `Config::load` fails on a path it cannot open, so an empty `--config`
    // would stop the compositor from starting.
    let args = args_of(&compositor(
        Path::new("/b/domicile-compositor"),
        Path::new("/l/engine"),
        Path::new("/b/domicile-open-url"),
        Path::new("/d/share"),
        &runtime(),
        None,
        &|_| None,
    ));
    assert!(
        !args.iter().any(|arg| arg == "--config"),
        "no config was asked for, so none should be named: {args:?}"
    );
}
