//! The three commands a desktop is, as data.
//!
//! Built rather than run, so what each process is started with is a value a
//! test can read. The flag lists were the part of the old shell script that
//! its tests could only reach by extracting the block and eval-ing it; here
//! they are ordinary assertions.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

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
    /// The host protocol, which the bridge serves and the compositor answers.
    pub chrome_socket: PathBuf,
    /// The engine's own profile, thrown away with the run.
    pub profile: PathBuf,
}

/// The bridge: it serves the shell's page and pipes the session.
///
/// Everything by environment rather than argv, as the bridge reads it: the
/// only caller is a launcher, and a launcher that has to quote paths into an
/// argv is a launcher with a bug in it the first time a checkout has a space
/// in its name.
pub fn bridge(bridge: &Path, module: &Path, runtime: &Runtime) -> Spawn {
    Spawn {
        args: Vec::new(),
        env: vec![
            ("DOMICILE_MODULE".to_string(), module.into()),
            (
                "DOMICILE_SOCKET".to_string(),
                runtime.chrome_socket.clone().into(),
            ),
        ],
        program: bridge.to_path_buf(),
    }
}

/// The engine, on the page the bridge is serving.
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
    url: &str,
    platform: &str,
    runtime: &Runtime,
    extra: Option<&str>,
) -> Spawn {
    let mut args: Vec<OsString> = vec![
        format!("--ozone-platform={platform}").into(),
        format!("--app={url}").into(),
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
    let mut session = runtime.chrome_socket.clone().into_os_string();
    session.push(".session");
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
            session,
            "--engine-socket".into(),
            runtime.broker.clone().into(),
        ],
        env: vec![
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
