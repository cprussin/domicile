//! Starting client processes on this desktop, with the environment that points
//! them at it.

use std::ffi::{OsStr, OsString};
use std::process::Command;
use std::thread;

use tracing::debug;

use domicile_host::priority;
use domicile_host::system::Environment;

use crate::grepped;
use crate::portals::CURRENT_DESKTOP;
use crate::{app_scope, engine};

/// Spawn a client process onto Domicile's display.
///
/// A reaper thread waits on the child so it doesn't become a zombie.
/// `scoped` starts it in its own systemd scope; see [`crate::app_scope`]. It
/// starts at nice value `nice`; see [`client_command`]. `activation_token`
/// lets it raise its window; see [`client_command`].
pub fn spawn_client(
    command: &[String],
    wayland_display: &OsStr,
    scoped: bool,
    nice: i32,
    activation_token: Option<&str>,
) {
    let Some(mut child) = client_command(
        command,
        wayland_display,
        std::env::var_os("LD_LIBRARY_PATH").as_deref(),
        scoped.then(app_scope::random),
        nice,
        activation_token,
    ) else {
        return;
    };
    match child.spawn() {
        Ok(mut child) => {
            // Logged after the fork for the pid, which pairs this line with
            // `app client connected`. See `peer_process`.
            debug!(
                pid = child.id(),
                ?command,
                ?wayland_display,
                "{}",
                grepped::SPAWNING
            );
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(err) => tracing::error!(
            %err,
            program = ?child.get_program(),
            ?command,
            "failed to spawn client"
        ),
    }
}

/// Build the command for a spawned client.
///
/// - `WAYLAND_DISPLAY` is set to ours. Our own may be the host session's, and a
///   client inheriting it would open there.
/// - `DISPLAY` is removed so dual-backend toolkits choose Wayland.
/// - There is no Xwayland, so X11-only defaults would fail;
///   [`WAYLAND_PREFERENCE`] overrides them.
/// - `LD_LIBRARY_PATH` loses the engine's directory; see
///   [`without_the_engine`].
/// - It starts at nice value `nice`, not the raised Wayland thread's; see
///   [`thread_priority`].
///
/// `DOMICILE_SOCK` is inherited unchanged: the launcher sets it to this
/// desktop's control socket.
///
/// With a `scope`, the client starts in its own systemd scope; see
/// [`app_scope::scoped`].
///
/// An `activation_token` is set as `XDG_ACTIVATION_TOKEN`, and as
/// `DESKTOP_STARTUP_ID` for toolkits that read only that. A singleton app
/// launched again hands it to its running instance, which raises its window.
/// See [`crate::activation`].
pub fn client_command(
    command: &[String],
    wayland_display: &OsStr,
    library_path: Option<&OsStr>,
    scope: Option<u64>,
    nice: i32,
    activation_token: Option<&str>,
) -> Option<Command> {
    let (program, args) = command.split_first()?;
    let words = match scope {
        Some(random) => app_scope::scoped(program, args, random),
        None => command.to_vec(),
    };
    let (program, args) = words.split_first().expect("both start with a program");
    let mut child = Command::new(program);
    child.args(args);
    for (name, value) in desktop_environment(wayland_display, library_path) {
        match value {
            Some(value) => child.env(name, value),
            None => child.env_remove(name),
        };
    }
    if let Some(token) = activation_token {
        child.env("XDG_ACTIVATION_TOKEN", token);
        child.env("DESKTOP_STARTUP_ID", token);
    }
    priority::starting_at(&mut child, nice);
    Some(child)
}

/// The variables [`client_command`] sets, or with `None` removes, so a process
/// runs in this desktop rather than the one the compositor was started from.
///
/// Also what the shell's processes run with; see `domicile_host::system`.
pub fn desktop_environment(wayland_display: &OsStr, library_path: Option<&OsStr>) -> Environment {
    [
        ("WAYLAND_DISPLAY", Some(wayland_display.to_os_string())),
        // For `OnlyShowIn` in `.desktop` files and for toolkits. Portal routing
        // uses the frontend's environment instead; see
        // `portals::say_which_desktop`.
        ("XDG_CURRENT_DESKTOP", Some(CURRENT_DESKTOP.into())),
        ("DISPLAY", None),
        ("LD_LIBRARY_PATH", library_path.and_then(without_the_engine)),
    ]
    .into_iter()
    .chain(
        WAYLAND_PREFERENCE
            .iter()
            .map(|&(name, value)| (name, Some(value.into()))),
    )
    .map(|(name, value)| (name.into(), value))
    .collect()
}

/// What each toolkit reads to choose Wayland over X11; see [`client_command`].
///
/// - `XDG_SESSION_TYPE`: what `--ozone-platform=auto` (Electron 38 and later,
///   and Chromium), Qt and GLFW look at when nothing more specific is set.
/// - `ELECTRON_OZONE_PLATFORM_HINT`: Electron 28 through 37, which otherwise
///   default to X11 (`element-desktop`, VS Code, Slack).
/// - `NIXOS_OZONE_WL`: nixpkgs' Electron and Chromium wrappers, which add the
///   Wayland flags only when it is set.
/// - `QT_QPA_PLATFORM`, `SDL_VIDEODRIVER`: Qt5 and SDL2, both X11 by default.
/// - `MOZ_ENABLE_WAYLAND`: Firefox before 121.
const WAYLAND_PREFERENCE: [(&str, &str); 6] = [
    ("XDG_SESSION_TYPE", "wayland"),
    ("ELECTRON_OZONE_PLATFORM_HINT", "wayland"),
    ("NIXOS_OZONE_WL", "1"),
    ("QT_QPA_PLATFORM", "wayland"),
    ("SDL_VIDEODRIVER", "wayland"),
    ("MOZ_ENABLE_WAYLAND", "1"),
];

/// `path` without any directory containing the engine, or `None` if nothing is
/// left.
///
/// The engine's directory is Chromium's and holds its own `libvulkan.so.1`,
/// built without Xlib surfaces. A client that loads it fails, for example:
///
///   libgtk-4.so.1: undefined symbol: vkCreateXlibSurfaceKHR
///
/// Detected by contents rather than a flag, so a hand-started compositor with a
/// Chromium `out` directory on its path is covered.
fn without_the_engine(path: &OsStr) -> Option<OsString> {
    let kept: Vec<_> = std::env::split_paths(path)
        .filter(|directory| !directory.join(engine::LIBRARY).exists())
        .collect();
    (!kept.is_empty())
        .then(|| std::env::join_paths(kept).expect("split on the separator it is joined with"))
}

/// The chrome's Wayland display name, derived from ours.
///
/// A separate socket, so the compositor knows which client is the chrome rather
/// than trusting a claim.
pub fn chrome_display(socket_name: &OsStr) -> String {
    format!("{}-chrome", socket_name.to_string_lossy())
}

/// The user's home directory, which the file index covers.
///
/// Read from the environment because it is a fact about the running user, not a
/// setting; configuration arrives on the command line. Spawned clients inherit
/// the same `HOME`, and `domicile_config` uses it to expand `~`.
pub fn home_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};

    use super::client_command;

    /// The value `client_command` sets for `name`; `None` means cleared.
    fn child_env(command: &[String], display: &str, name: &str) -> Option<OsString> {
        child_env_from(command, display, None, name)
    }

    /// [`child_env`], for a compositor with `library_path` as its
    /// `LD_LIBRARY_PATH`.
    fn child_env_from(
        command: &[String],
        display: &str,
        library_path: Option<&OsStr>,
        name: &str,
    ) -> Option<OsString> {
        client_command(command, OsStr::new(display), library_path, None, 0, None)
            .expect("a command with a program builds")
            .get_envs()
            .find(|(key, _)| *key == OsStr::new(name))
            .map(|(_, value)| value.map(OsStr::to_os_string))
            .expect("the variable is one this sets or clears")
    }

    fn kitty() -> Vec<String> {
        vec!["kitty".to_string()]
    }

    #[test]
    fn a_spawned_client_is_pointed_at_our_display_not_the_one_we_inherited() {
        // The compositor's own `WAYLAND_DISPLAY` may be the host's. A child
        // inheriting it would open on the host desktop.
        assert_eq!(
            child_env(&kitty(), "wayland-7", "WAYLAND_DISPLAY"),
            Some(OsString::from("wayland-7")),
        );
    }

    #[test]
    fn a_spawned_client_gets_no_x_display() {
        assert_eq!(child_env(&kitty(), "wayland-7", "DISPLAY"), None);
    }

    #[test]
    fn a_spawned_client_is_told_to_speak_wayland() {
        // No Xwayland, so X11-default toolkits (Electron, SDL2) would fail to
        // start. Inherited X settings are overridden.
        for (name, value) in [
            ("XDG_SESSION_TYPE", "wayland"),
            ("ELECTRON_OZONE_PLATFORM_HINT", "wayland"),
            ("NIXOS_OZONE_WL", "1"),
            ("QT_QPA_PLATFORM", "wayland"),
            ("SDL_VIDEODRIVER", "wayland"),
            ("MOZ_ENABLE_WAYLAND", "1"),
        ] {
            assert_eq!(
                child_env(&kitty(), "wayland-7", name),
                Some(OsString::from(value)),
                "{name}",
            );
        }
    }

    #[test]
    fn a_spawned_client_is_told_which_desktop_it_is_on() {
        // `xdg-desktop-portal` matches this against `UseIn=` in `.portal`
        // files, routing color scheme queries to our settings backend.
        assert_eq!(
            child_env(&kitty(), "wayland-7", "XDG_CURRENT_DESKTOP"),
            Some(OsString::from("domicile")),
        );
    }

    /// A directory with a stand-in engine library, as the launcher puts on
    /// `LD_LIBRARY_PATH`.
    fn engine_directory() -> tempfile::TempDir {
        let directory = tempfile::tempdir().expect("a temporary directory");
        std::fs::write(directory.path().join(crate::engine::LIBRARY), b"")
            .expect("the stand-in is written");
        directory
    }

    #[test]
    fn a_spawned_client_does_not_load_the_engines_libraries() {
        // The engine's directory holds Chromium's `libvulkan.so.1`, built
        // without Xlib surfaces. GTK 4 loaded it and failed:
        //
        //   libgtk-4.so.1: undefined symbol: vkCreateXlibSurfaceKHR
        let engine = engine_directory();
        let ours = std::env::join_paths([engine.path(), std::path::Path::new("/opt/lib")])
            .expect("joinable");
        assert_eq!(
            child_env_from(&kitty(), "wayland-7", Some(&ours), "LD_LIBRARY_PATH"),
            Some(OsString::from("/opt/lib")),
        );
    }

    #[test]
    fn a_spawned_client_of_a_compositor_that_only_had_the_engine_gets_no_library_path() {
        let engine = engine_directory();
        assert_eq!(
            child_env_from(
                &kitty(),
                "wayland-7",
                Some(engine.path().as_os_str()),
                "LD_LIBRARY_PATH"
            ),
            None,
        );
    }

    #[test]
    fn a_launched_client_is_handed_a_token_to_raise_its_window() {
        // A singleton app launched again passes it to its running instance,
        // which raises its window with it.
        let child = client_command(
            &kitty(),
            OsStr::new("wayland-7"),
            None,
            None,
            0,
            Some("t0k"),
        )
        .expect("a command with a program builds");
        for name in ["XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"] {
            assert!(
                child
                    .get_envs()
                    .any(|pair| pair == (OsStr::new(name), Some(OsStr::new("t0k")))),
                "{name}: {child:?}"
            );
        }
    }

    #[test]
    fn an_empty_command_spawns_nothing() {
        assert!(client_command(&[], OsStr::new("wayland-7"), None, None, 0, None).is_none());
    }

    #[test]
    fn a_scoped_client_keeps_the_desktops_environment() {
        // `systemd-run --scope` execs the client with its own environment.
        let child = client_command(&kitty(), OsStr::new("wayland-7"), None, Some(7), 0, None)
            .expect("a command with a program builds");
        assert_eq!(child.get_program(), "systemd-run");
        assert!(
            child
                .get_envs()
                .any(|pair| pair == (OsStr::new("WAYLAND_DISPLAY"), Some(OsStr::new("wayland-7")))),
            "{child:?}"
        );
    }

    #[test]
    fn an_unscoped_client_starts_itself() {
        let child = client_command(&kitty(), OsStr::new("wayland-7"), None, None, 0, None)
            .expect("a command with a program builds");
        assert_eq!(child.get_program(), "kitty");
    }

    /// The Wayland thread runs raised; a client starts at the nice value it is
    /// given instead.
    #[test]
    fn a_client_starts_at_the_nice_value_it_is_given() {
        use domicile_host::priority::{nice, this_thread};
        let given = nice(this_thread()).unwrap() + 3;

        let ran = client_command(
            &["nice".into()],
            OsStr::new("wayland-7"),
            None,
            None,
            given,
            None,
        )
        .expect("a command with a program builds")
        .output()
        .expect("`nice` runs");

        assert_eq!(String::from_utf8(ran.stdout).unwrap(), format!("{given}\n"));
    }
}
