//! The two commands a desktop is -- the engine and the compositor -- as data.
//!
//! Built rather than run, so what each process is started with is a value a
//! test can read. The flag lists were the part of the old shell script that
//! its tests could only reach by extracting the block and eval-ing it; here
//! they are ordinary assertions.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::control_socket::VARIABLE;
use crate::shell_path::Shell;

/// The document the fork generates, and what a desktop is started on. One
/// host and one path: `domicile_scheme.h` says there is no second host, and
/// naming one is how a request for something that is not the shell is refused.
///
/// THE BARE ROOT, AND IT HAS TO BE. The engine writes this document rather
/// than reading it off disk — a shell is a module, and the page that loads it
/// is the fork's — so `ShellURLLoaderFactory::CreateLoaderAndStart` answers a
/// path of `/` itself and hands anything else to the file resolver. Asking for
/// `index.html` went to the resolver, which looked for a file of that name
/// under the shell root; a built shell is `shell.js` and nothing else, so
/// there was none, and a desktop came up on an empty window with nothing said
/// anywhere. `shell_url_loader_factory_unittest.cc` asserts the other side of
/// this: `domicile://shell/` must resolve to no file at all.
const SHELL_DOCUMENT: &str = "domicile://shell/";

/// A child process, before anything has been started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spawn {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
}

/// Where the sockets live for one run, and the profile it uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    /// The socket the engine opens and the compositor submits through.
    pub broker: PathBuf,
    /// The host protocol: the compositor listens, and the engine dials it for
    /// the page's control channel.
    pub chrome_socket: PathBuf,
    /// Where the engine takes `load_shell`, and what the supervisor dials to
    /// carry `domicile load-shell` out.
    ///
    /// Under the run's own directory, beside the two above and unlike
    /// [`Runtime::control`]: the supervisor names this path and then dials it
    /// itself, so nothing outside this run has to be able to find it. The
    /// control socket is the other case — a person types a command in some
    /// other terminal — and that is what pays for a name anybody can work out.
    pub command: PathBuf,
    /// Where this desktop answers `domicile which-shell` and takes a
    /// `domicile load-shell`.
    ///
    /// The one socket of the run that is not under the run's own directory:
    /// the others are dialed by something this launcher started and told, and
    /// this one is dialed by whoever types a command, so it goes where
    /// [`crate::control_socket::address`] says and is named in the
    /// environment.
    pub control: PathBuf,
    /// The engine's own profile, kept between runs — see
    /// [`crate::profile_path`].
    pub profile: PathBuf,
    /// Where the compositor publishes what it bound, once it is serving.
    ///
    /// Named here rather than derived from `chrome_socket` inside
    /// [`compositor`] because the launcher waits on this file: a compositor
    /// that never publishes one is a desktop that never comes up, and a path
    /// only the argument builder knew is one nothing could say that about.
    pub session: PathBuf,
}

/// The engine, on the shell's module.
///
/// THREE FLAGS REPLACED A PORT. The page used to be served by a bridge over
/// HTTP on a loopback port, and it reached the compositor through a WebSocket
/// on that same port — so every process on the machine could reach a protocol
/// carrying `Spawn`. The fork serves the shell over `domicile://` and binds
/// the control channel to the document's origin, so what the engine needs
/// instead is where the files are, which module to load, and which socket the
/// compositor is on.
///
/// `--app` because a desktop is not a browser looking at a page. Without it
/// the window carries a tab strip, an address bar and a bookmarks row — about
/// 146 pixels of somebody else's chrome above the shell's own — and the
/// browser keeps its own keyboard shortcuts bound where a shell wants to bind
/// them.
///
/// THE SANDBOX STAYS ON, and there is no `--enable-blink-features`. Each was
/// there once and each drew a yellow "unsupported flag" bar across the top of
/// the desktop, which is what a user sees first and reasonably reads as
/// broken. A machine that needs either says so through `extra`, because
/// whatever one machine needs is a fact about that machine rather than about
/// the command every machine runs.
/// The ozone platform that drives a CRTC rather than living in somebody else's
/// session. `domicile-launch` is where the name is decided, so it is where the
/// one behavior that depends on it belongs.
const SCANOUT_PLATFORM: &str = "drm";

/// The ozone platform that is somebody else's client, and the other half of
/// the same rule: the one behavior that depends on being nested is decided
/// here, where the platform name is.
const NESTED_PLATFORM: &str = "wayland";

pub fn engine(
    engine: &Path,
    shell: &Shell,
    platform: &str,
    runtime: &Runtime,
    extra: Option<&str>,
) -> Spawn {
    let mut args: Vec<OsString> = vec![
        format!("--ozone-platform={platform}").into(),
        format!("--app={SHELL_DOCUMENT}").into(),
        format!("--domicile-shell-root={}", shell.root.display()).into(),
        // Relative, not a path from this machine's root: the fork puts it in
        // the document it generates as `<script src>`, resolved against
        // `domicile://shell/`.
        //
        // And whatever the shell called it. This was a `shell.js` constant the
        // launcher held, which meant a shell whose build emitted any other
        // name could not be run: the engine was sent for a file nobody had
        // named. The name belongs to the build now — `flake.nix` is where this
        // repository's own shells are held to `shell.js` — and by the time a
        // command line has been read there is nothing left to know about it.
        format!("--domicile-shell-module={}", shell.module.display()).into(),
        format!(
            "--domicile-control-socket={}",
            runtime.chrome_socket.display()
        )
        .into(),
        // WHERE A RUNNING DESKTOP IS TOLD TO SERVE ANOTHER SHELL. The engine
        // binds this and answers `load_shell` on it; the supervisor dials it
        // when somebody types `domicile load-shell`. Given on every run rather
        // than only in a dev loop: which shell a desktop serves is not a
        // developer's question, and an engine started without it is one whose
        // shell cannot be replaced without stopping the desktop.
        format!("--domicile-command-socket={}", runtime.command.display()).into(),
        // WHAT THE ENGINE SAYS ABOUT A DEAF DESKTOP IS ONE SEVERITY BELOW
        // WHAT IT PRINTS. `base/logging.cc` writes a message to stderr when
        // `LOG_TO_STDERR` is in the destination OR when the message is at
        // least `kAlwaysPrintErrorLevel`, which is `LOGGING_ERROR` -- and a
        // release build that was never given `--enable-logging` has
        // `LOG_TO_STDERR` clear. Every line the fork writes about an input
        // device logind handed over already revoked, about a force pause that
        // took every keyboard at once, about a console it has just taken
        // back, is a `LOG(WARNING)`, and every one of them went nowhere.
        //
        // That is not a missing feature, it is a wrong diagnosis: a run that
        // came up with no keyboard and no trackpad produced a log with not
        // one line about input in it, and an empty log reads as "none of that
        // code ran" rather than "it ran and said so quietly".
        //
        // WARNING and above, not INFO. This is the engine's account of its
        // own console, not a trace of the browser; `--log-level=0` through
        // `extra` is how a run asks for the rest, and it wins because
        // `CommandLine::AppendSwitchNative` keeps the last value of a switch
        // given twice.
        "--enable-logging=stderr".into(),
        "--log-level=1".into(),
        // A TOUCHPAD IS NOBODY'S UNTIL THIS SAYS SO. `CreateConverter` has one
        // touchpad branch and it is `#if defined(USE_EVDEV_GESTURES)`, whose
        // gn flag is `is_chromeos_device`; a pad that misses it is not a
        // touchscreen either, so it falls through to
        // `EventConverterEvdevImpl`, which handles `EV_REL` and has no
        // `EV_ABS` case. Every finger position is read off the descriptor and
        // dropped, `cursor_->MoveCursor` is never reached, and nothing logs
        // because nothing failed: a pointer on the screen that no amount of
        // swiping moves.
        //
        // `EventDeviceInfo::UseLibinput` prefers an OVERRIDDEN
        // `kLibinputHandleTouchpad` to its own heuristics, and the feature is
        // `FEATURE_DISABLED_BY_DEFAULT`, so this override is the whole
        // mechanism. It is a flag rather than a patch so that the decision is
        // somewhere a person can see it and turn it off; patch 0027 is the
        // half that cannot be a flag, because libinput's `open_restricted` has
        // to be handed the descriptor logind opened rather than open a device
        // node this browser has no right to.
        //
        // A SECOND `--enable-features` IN `extra` REPLACES THIS ONE RATHER
        // THAN ADDING TO IT, because `CommandLine::AppendSwitchNative` keeps
        // the last value of a switch given twice -- the same rule
        // `--log-level` above relies on, working against us here. A run that
        // wants another feature has to name this one alongside it.
        "--enable-features=LibinputHandleTouchpad".into(),
        "--password-store=basic".into(),
        "--no-first-run".into(),
        format!("--user-data-dir={}", runtime.profile.display()).into(),
        format!("--domicile-broker-socket={}", runtime.broker.display()).into(),
    ];
    // ON A TTY THE WINDOW IS THE SCREEN, and saying so is not cosmetic.
    // ozone/drm binds a window to a display controller only when the window's
    // rectangle is EXACTLY the CRTC's -- `ScreenManager::FindWindowAt`
    // compares whole rects -- so a window one pixel off is a window with no
    // controller, and every page flip it makes is dropped before it reaches
    // the kernel. That is a black screen with nothing wrong in the log, and it
    // is what Chromium's default window gets you: `kWindowMaxDefaultWidth`
    // wide, inset by ten pixels, which on a 2880x1920 panel is 1050x1900 at
    // (10, 10).
    //
    // Fullscreen rather than `--window-size`, because the size is not ours to
    // know: this panel advertises more than one preferred mode and ozone takes
    // the first, so a number written here is a guess that goes stale on the
    // next monitor. `DrmWindowHost::SetFullscreen` answers with the display's
    // own bounds, which come from the same snapshot the modeset used.
    //
    // Only on the platform that scans out. A nested run is a window inside
    // somebody else's session, and one that goes fullscreen on startup is one
    // a developer has to fight back out of.
    if platform == SCANOUT_PLATFORM {
        args.push("--start-fullscreen".into());
    }
    // NESTED, THE SHELL HAS NO META KEY UNTIL THE HOST IS ASKED TO GIVE IT UP.
    // Every binding `shell-manganese` claims is a Meta chord, and a host
    // compositor matches its own bindings before it sends a key to the focused
    // client at all -- so Meta+Enter opened sway's terminal and the shell was
    // never told anything happened. `zwp_keyboard_shortcuts_inhibit_unstable_v1`
    // is the protocol for saying "not while this surface has the keyboard", and
    // patch 0038 is the engine asking for it.
    //
    // A SWITCH RATHER THAN SOMETHING THE ENGINE WORKS OUT FROM ITS PLATFORM.
    // The ozone/wayland code that creates the inhibitor is reached by every
    // nested run of this engine, and most of those are not desktops: every
    // `packages/domicile-engine/scripts/guard-*.sh` that runs under
    // `under-wayland.sh` starts `chrome --ozone-platform=wayland` by hand, and
    // a guard that silently swallows the whole keymap of the session it is
    // running in is a guard nobody can debug next to. Taking a person's
    // shortcuts away is a decision about the run, not a property of the
    // platform, so it is made where the rest of them are -- beside
    // `--start-fullscreen`, for the same reason.
    //
    // NO ESCAPE HATCH IS SPELLED HERE because the compositor already has one
    // and it is the one that works: sway honors an inhibitor per seat, and
    // `bindsym --inhibited` keeps a binding alive through it.
    // `docs/RUNNING-A-DESKTOP.md` says so, because a user whose keymap goes
    // dead the moment the desktop takes focus needs that sentence and not this
    // comment.
    if platform == NESTED_PLATFORM {
        args.push("--domicile-inhibit-host-shortcuts".into());
    }
    // Word-split, which is what an argument list in an environment variable is
    // for; empty runs of spaces are not arguments.
    args.extend(
        extra
            .unwrap_or_default()
            .split_whitespace()
            .map(OsString::from),
    );
    Spawn {
        args,
        env: Vec::new(),
        program: engine.join("chrome"),
    }
}

/// The compositor, as a producer to the engine.
///
/// `DOMICILE_SOCK` is set here rather than on this process, and that is what
/// puts it in front of a person. The compositor is what starts the apps a
/// shell asks for, and a child inherits the environment it was spawned from —
/// so a terminal opened inside this desktop has this desktop's socket, and
/// `domicile which-shell` typed into it reaches the desktop it is running in
/// rather than some other one. Exporting it from the supervisor's own process
/// instead would be inherited by nothing that matters, and a supervisor
/// started from inside another desktop would still be carrying that desktop's
/// path.
///
/// `LD_LIBRARY_PATH` carries the engine's own directory because that is where
/// `libdomicile_engine.so` is: the compositor `dlopen`s it rather than linking
/// it, so that `cargo build` does not need a Chromium checkout. Prepended
/// rather than replacing: a machine that set one is telling the compositor
/// where to find something, and dropping it swaps one missing library for
/// another.
pub fn compositor(
    compositor: &Path,
    engine: &Path,
    runtime: &Runtime,
    config: Option<&Path>,
    inherited: &dyn Fn(&str) -> Option<String>,
) -> Spawn {
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
    ];
    // ABSENT RATHER THAN EMPTY WHERE THERE IS NO CONFIG. The compositor reads
    // a missing `--config` as its defaults and refuses a path it cannot load,
    // so passing the flag with nothing behind it would turn "this desktop
    // writes no monitors down" into a startup failure.
    if let Some(path) = config {
        args.push("--config".into());
        args.push(path.into());
    }
    Spawn {
        args,
        env: vec![
            (VARIABLE.to_string(), runtime.control.clone().into()),
            ("LD_LIBRARY_PATH".to_string(), libraries),
            (
                "RUST_LOG".to_string(),
                // Quiet by default: warnings, and the compositor's few `INFO`
                // lines (`domicile` is the target the latency spike reports
                // under). Everything routine is at `DEBUG`. An explicit level
                // wins: somebody who set it is asking for something else.
                inherited("RUST_LOG")
                    .unwrap_or_else(|| "warn,domicile_compositor=info,domicile=info".to_string())
                    .into(),
            ),
        ],
        program: compositor.to_path_buf(),
    }
}
