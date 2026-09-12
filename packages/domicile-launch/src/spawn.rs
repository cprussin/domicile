//! The three commands a desktop is, as data.
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

/// Where the sockets and the profile live for one run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    /// The socket the engine opens and the compositor submits through.
    pub broker: PathBuf,
    /// The host protocol: the compositor listens, and the engine dials it for
    /// the page's control channel.
    pub chrome_socket: PathBuf,
    /// Where this desktop answers `domicile which-shell`.
    ///
    /// The one socket of the run that is not under the run's own directory:
    /// the others are dialled by something this launcher started and told, and
    /// this one is dialled by whoever types a command, so it goes where
    /// [`crate::control_socket::address`] says and is named in the
    /// environment.
    pub control: PathBuf,
    /// The engine's own profile, thrown away with the run.
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
        "--password-store=basic".into(),
        "--no-first-run".into(),
        format!("--user-data-dir={}", runtime.profile.display()).into(),
        format!("--domicile-broker-socket={}", runtime.broker.display()).into(),
    ];
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
    inherited: &dyn Fn(&str) -> Option<String>,
) -> Spawn {
    let mut libraries = OsString::from(engine);
    if let Some(theirs) = inherited("LD_LIBRARY_PATH") {
        libraries.push(":");
        libraries.push(theirs);
    }
    Spawn {
        args: vec![
            "--chrome-socket".into(),
            runtime.chrome_socket.clone().into(),
            "--session".into(),
            runtime.session.clone().into(),
            "--engine-socket".into(),
            runtime.broker.clone().into(),
        ],
        env: vec![
            (VARIABLE.to_string(), runtime.control.clone().into()),
            ("LD_LIBRARY_PATH".to_string(), libraries),
            (
                "RUST_LOG".to_string(),
                // The level a desktop is worth watching at. An explicit one
                // wins: somebody who set it is asking for something else.
                inherited("RUST_LOG")
                    .unwrap_or_else(|| "info,domicile_compositor=debug".to_string())
                    .into(),
            ),
        ],
        program: compositor.to_path_buf(),
    }
}
