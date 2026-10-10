//! The Settings app's native messaging host. Chrome starts it when the app
//! connects, with the engine's environment, and stops it when the app's port
//! closes.
//!
//! The protocol is in `domicile_launch::settings`; this file reads the
//! environment, the files and the sockets. See `docs/SETTINGS.md`.

use std::ffi::CString;
use std::io::Write;
use std::os::unix::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};

use domicile_launch::control::{Request, Response};
use domicile_launch::control_socket::{advertised, ask, PATIENCE, VARIABLE};
use domicile_launch::settings::{answer, read_message, watched, write_message, Host};
use notify::Watcher as _;
use serde_json::json;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        // stderr reaches the engine's log; stdout belongs to Chrome.
        Err(why) => {
            eprintln!("domicile-settings-host: {why}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let socket =
        advertised(std::env::var(VARIABLE).ok().as_deref()).map_err(|why| why.to_string())?;
    // The desktop waits up to PATIENCE on the engine for site permissions.
    let asking = |request: &Request| {
        ask(&socket, request, Some(PATIENCE * 2)).map_err(|why| why.to_string())
    };
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let _watching = watching(&asking, Arc::clone(&output))?;

    let host = Host {
        ask: &asking,
        read: &|path| std::fs::read_to_string(path),
        writable: &writable,
        write: &|path, text| std::fs::write(path, text),
    };
    let mut input = std::io::stdin().lock();
    while let Some(message) =
        read_message(&mut input).map_err(|why| format!("cannot read the app: {why}"))?
    {
        let reply = answer(&message, &host);
        say(&output, &reply)?;
    }
    Ok(())
}

/// Tells the app `{"type":"changed"}` whenever a settings file changes on
/// disk, so an edit elsewhere shows in the app.
///
/// Watches each file's directory without recursing: a file is often replaced
/// by a rename, and its directory may be as large as the Nix store.
fn watching(
    asking: &dyn Fn(&Request) -> Result<Response, String>,
    output: Arc<Mutex<std::io::Stdout>>,
) -> Result<notify::RecommendedWatcher, String> {
    let files = match asking(&Request::SettingsFiles)? {
        Response::SettingsFiles { files } => files,
        other => return Err(format!("the desktop answered {other:?} for its files")),
    };
    let edited: Vec<PathBuf> = [files.config.clone(), files.shell.clone()]
        .into_iter()
        .flatten()
        .collect();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let event = match event {
            Ok(event) => event,
            // The app still answers; it just misses edits made elsewhere.
            Err(why) => {
                eprintln!("domicile-settings-host: a watch failed: {why}");
                return;
            }
        };
        let changed = event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove();
        if changed && event.paths.iter().any(|path| edited.contains(path)) {
            if let Err(why) = say(&output, &json!({"type": "changed"})) {
                eprintln!("domicile-settings-host: {why}");
            }
        }
    })
    .map_err(|why| format!("cannot watch the settings files: {why}"))?;
    for directory in watched(&files) {
        watcher
            .watch(&directory, notify::RecursiveMode::NonRecursive)
            .map_err(|why| format!("cannot watch {}: {why}", directory.display()))?;
    }
    Ok(watcher)
}

/// Sends one message to the app. Replies and change notices share stdout.
fn say(output: &Mutex<std::io::Stdout>, message: &serde_json::Value) -> Result<(), String> {
    let mut output = output.lock().expect("no writer panics holding stdout");
    write_message(&mut *output, message)
        .and_then(|()| output.flush())
        .map_err(|why| format!("cannot answer the app: {why}"))
}

/// Whether this user may write `path`, following links: a link into the Nix
/// store is read-only.
fn writable(path: &Path) -> bool {
    let path = CString::new(path.as_os_str().as_bytes()).expect("a path has no NUL byte");
    // SAFETY: `path` is a NUL-terminated string that outlives the call.
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}
