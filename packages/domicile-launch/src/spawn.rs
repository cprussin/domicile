//! Builds the engine and compositor command lines as data, so tests can
//! inspect them.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::control_socket::VARIABLE;
use crate::shell_path::Shell;

/// The URL of the shell page the engine generates.
///
/// It must be the bare root. `ShellURLLoaderFactory` generates the page only
/// for `/` and serves any other path from the shell root on disk.
const SHELL_DOCUMENT: &str = "domicile://shell/";

/// A child process to start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spawn {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
}

/// The socket and file paths for one run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    /// The engine's broker socket, which the compositor submits frames
    /// through.
    pub broker: PathBuf,
    /// The host protocol socket. The compositor listens and the engine dials
    /// it for the page's control channel.
    pub chrome_socket: PathBuf,
    /// The engine's command socket, which the supervisor dials for
    /// `domicile load-shell`.
    ///
    /// Lives in the run directory, since only the supervisor dials it.
    pub command: PathBuf,
    /// The control socket for `domicile which-shell` and
    /// `domicile load-shell`.
    ///
    /// Users' commands dial it, so it lives at
    /// [`crate::control_socket::address`] rather than in the run directory.
    pub control: PathBuf,
    /// The engine profile, kept between runs. See [`crate::profile_path`].
    pub profile: PathBuf,
    /// A per-run directory put first on every app's `PATH`. Its `xdg-open` is
    /// `domicile-xdg-open`; see [`crate::xdg_open`].
    pub shims: PathBuf,
    /// The session file the compositor writes once it is serving.
    ///
    /// Set here rather than derived in [`compositor`] because the launcher
    /// waits on it.
    pub session: PathBuf,
    /// The clients the compositor launched, kept across a compositor restart
    /// so the next one launches again those the crash took. See
    /// `domicile_compositor::launches`.
    pub launches: PathBuf,
}

/// The ozone platform that drives the display directly.
const SCANOUT_PLATFORM: &str = "drm";

/// The ozone platform that runs as a client of another compositor.
const NESTED_PLATFORM: &str = "wayland";

/// The engine command line for `shell`.
///
/// `--app` hides the browser's tab strip, address bar and shortcuts.
/// `--no-sandbox` is not passed by default because it shows an "unsupported
/// flag" bar. A machine that needs it adds it through `extra`.
///
/// `extra` is split on whitespace. Its `--enable-features` and
/// `--disable-features` values are merged into one switch each, since the
/// last copy of a switch wins and would drop the built-in features.
pub fn engine(
    engine: &Path,
    shell: &Shell,
    platform: &str,
    runtime: &Runtime,
    extra: Option<&str>,
) -> Spawn {
    let extra = Extra::parse(extra.unwrap_or_default());
    let mut args: Vec<OsString> = vec![
        format!("--ozone-platform={platform}").into(),
        format!("--app={SHELL_DOCUMENT}").into(),
        format!("--domicile-shell-root={}", shell.root.display()).into(),
        // Relative: the generated page uses it as a `<script src>` resolved
        // against `domicile://shell/`.
        format!("--domicile-shell-module={}", shell.module.display()).into(),
        format!(
            "--domicile-control-socket={}",
            runtime.chrome_socket.display()
        )
        .into(),
        // Lets `domicile load-shell` swap the shell without a restart. Passed
        // on every run, not only in development.
        format!("--domicile-command-socket={}", runtime.command.display()).into(),
        // Log ERROR and above to stderr. The fork reports problems at ERROR.
        // WARNING adds a dozen routine upstream lines on every nested start.
        // `--enable-logging` lets `--log-level=0` or `1`, or `--v=1`, in
        // `extra` show more, since the last copy of a switch wins.
        "--enable-logging=stderr".into(),
        "--log-level=2".into(),
        // Route touchpads and mice through libinput. Without it, a non-ChromeOS
        // build handles them with `EventConverterEvdevImpl`, which ignores
        // touchpad motion and the mouse wheel, and has no pointer
        // acceleration. Both features are off by default.
        ["--enable-features=LibinputHandleTouchpad,LibinputHandleMouse"]
            .into_iter()
            .chain(extra.enabled)
            .collect::<Vec<_>>()
            .join(",")
            .into(),
        "--password-store=basic".into(),
        "--no-first-run".into(),
        format!("--user-data-dir={}", runtime.profile.display()).into(),
        format!("--domicile-broker-socket={}", runtime.broker.display()).into(),
    ];
    // On drm, a window drives a CRTC only if its bounds match the CRTC's
    // exactly (`ScreenManager::FindWindowAt`). Otherwise its page flips are
    // dropped and the screen stays black. Fullscreen takes the display's own
    // bounds, which `--window-size` cannot know in advance. Nested runs skip
    // this so the window stays a normal window.
    //
    // Chromium's fallback after three GPU process crashes is software
    // compositing, which takes windows only in shared memory. The compositor
    // decided at start to send dmabufs (see `crate::software_compositing`),
    // so the fallback would blank every window. Without the limit it
    // relaunches the GPU process instead.
    if platform == SCANOUT_PLATFORM {
        args.push("--start-fullscreen".into());
        args.push("--disable-gpu-process-crash-limit".into());
    }
    // When nested, ask the host compositor to pass its shortcuts through
    // (`zwp_keyboard_shortcuts_inhibit_unstable_v1`). Otherwise the host
    // takes the shell's Meta chords. This is a switch, not engine default,
    // because the engine's own test scripts also run nested and should not
    // capture the developer's keymap. Host bindings that must still work use
    // sway's `bindsym --inhibited`; see `docs/RUNNING-A-DESKTOP.md`.
    if platform == NESTED_PLATFORM {
        args.push("--domicile-inhibit-host-shortcuts".into());
    }
    if !extra.disabled.is_empty() {
        args.push(format!("{DISABLE_FEATURES}{}", extra.disabled.join(",")).into());
    }
    args.extend(extra.rest.into_iter().map(OsString::from));
    Spawn {
        args,
        // For the programs the engine starts, such as an app's
        // `domicile-app-host`, so they reach this desktop.
        env: vec![(VARIABLE.to_string(), runtime.control.clone().into())],
        program: engine.join("chrome"),
    }
}

/// Makes an [`engine`] on drm composite on the CPU, for a card with no 3D.
/// See [`crate::software_compositing`].
pub fn composite_on_the_cpu(engine: &mut Spawn) {
    engine.args.push("--disable-gpu".into());
}

/// Makes a [`compositor`] hand the engine windows in shared memory, for an
/// engine that composites on the CPU. See [`crate::software_compositing`].
pub fn send_frames_in_memory(compositor: &mut Spawn) {
    compositor.args.push("--software-compositing".into());
    compositor.args.push("yes".into());
}

/// The compositor command line.
///
/// The compositor starts apps, so its environment is what apps inherit:
///
/// - `DOMICILE_SOCK`: `domicile` commands in a terminal reach this desktop.
/// - `BROWSER`: `domicile-open-url`, a single program because many readers
///   don't split the value.
/// - `PATH`: [`Runtime::shims`] first, so `xdg-open` opens links here.
/// - `XDG_DATA_DIRS`: `data` first, so GIO finds `domicile-mimeapps.list`.
///   A user's own `mimeapps.list` still wins. The portal does not see this;
///   see `ROADMAP.md`.
/// - `LD_LIBRARY_PATH`: the engine directory first, for the
///   `libdomicile_engine.so` the compositor `dlopen`s. The compositor removes
///   it again for its clients.
///
/// `scope_clients` passes `--scope-clients yes`, for a desk that is the login
/// session.
#[allow(clippy::too_many_arguments)] // Each from a different part of the run.
pub fn compositor(
    compositor: &Path,
    engine: &Path,
    browser: &Path,
    data: &Path,
    runtime: &Runtime,
    config: Option<&Path>,
    scope_clients: bool,
    inherited: &dyn Fn(&str) -> Option<String>,
) -> Spawn {
    let mut path = OsString::from(&runtime.shims);
    if let Some(theirs) = inherited("PATH") {
        path.push(":");
        path.push(theirs);
    }
    // Unset means `/usr/local/share:/usr/share` per the XDG spec, so keep
    // those after ours.
    let mut data_dirs = OsString::from(data);
    data_dirs.push(":");
    data_dirs.push(
        inherited("XDG_DATA_DIRS")
            .filter(|theirs| !theirs.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string()),
    );
    let mut libraries = OsString::from(engine);
    if let Some(theirs) = inherited("LD_LIBRARY_PATH") {
        libraries.push(":");
        libraries.push(theirs);
    }
    let mut args: Vec<OsString> = vec![
        "--chrome-socket".into(),
        runtime.chrome_socket.clone().into(),
        "--session".into(),
        runtime.session.clone().into(),
        "--engine-socket".into(),
        runtime.broker.clone().into(),
        "--launches".into(),
        runtime.launches.clone().into(),
    ];
    // Omit `--config` when there is none. The compositor uses defaults for a
    // missing flag but fails on a path it cannot load.
    if let Some(path) = config {
        args.push("--config".into());
        args.push(path.into());
    }
    if scope_clients {
        args.push("--scope-clients".into());
        args.push("yes".into());
    }
    Spawn {
        args,
        env: vec![
            (VARIABLE.to_string(), runtime.control.clone().into()),
            ("BROWSER".to_string(), browser.into()),
            ("PATH".to_string(), path),
            ("XDG_DATA_DIRS".to_string(), data_dirs),
            ("LD_LIBRARY_PATH".to_string(), libraries),
            (
                "RUST_LOG".to_string(),
                // Warnings plus the compositor's few `INFO` lines (latency
                // spikes report under `domicile`). An inherited value wins.
                inherited("RUST_LOG")
                    .unwrap_or_else(|| "warn,domicile_compositor=info,domicile=info".to_string())
                    .into(),
            ),
        ],
        program: compositor.to_path_buf(),
    }
}

const ENABLE_FEATURES: &str = "--enable-features=";

const DISABLE_FEATURES: &str = "--disable-features=";

/// The `extra` engine switches, with the feature lists apart from the rest.
struct Extra<'a> {
    enabled: Vec<&'a str>,
    disabled: Vec<&'a str>,
    rest: Vec<&'a str>,
}

impl<'a> Extra<'a> {
    /// Splits on whitespace; runs of spaces produce no empty arguments.
    fn parse(extra: &'a str) -> Self {
        let mut parsed = Extra {
            enabled: Vec::new(),
            disabled: Vec::new(),
            rest: Vec::new(),
        };
        for arg in extra.split_whitespace() {
            match (
                arg.strip_prefix(ENABLE_FEATURES),
                arg.strip_prefix(DISABLE_FEATURES),
            ) {
                (Some(features), _) => parsed.enabled.push(features),
                (_, Some(features)) => parsed.disabled.push(features),
                (None, None) => parsed.rest.push(arg),
            }
        }
        parsed
    }
}
