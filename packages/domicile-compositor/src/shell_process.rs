//! Starting the shell, which is the one part of it that is not a decision.
//!
//! Every choice in running a shell — which package a reference names, where a
//! named one is looked for, what runs it and what it is told — is
//! `domicile-shell`'s, and is a value under test there. What is here is the
//! process: handing that value to the OS, saying loudly when the OS will not
//! take it, and reaping the child so it does not outlive itself as a zombie.

use std::process::{Child, Command};
use std::thread;

use domicile_config::Config;
use domicile_shell::{
    launch_command, resolve, runtime_from, shell_for, ChromeSession, ConfigOrigin, ShellError,
    ShellRequest, XdgDirs,
};
use tracing::{info, warn};

/// Start the shell this run asked for, if it asked for one.
///
/// Asking for none is the headless case every end-to-end check drives, where
/// something else connects to the socket. A run that *did* ask and cannot have
/// one is an error rather than a warning: a compositor whose chrome never
/// starts is a desktop with nothing drawn on it, and carrying on would show
/// exactly the black window a user cannot diagnose.
///
/// Nothing is returned. A `Child` the caller merely holds is not a handle on
/// anything — dropping one detaches rather than ends it — so the process is
/// handed to a thread that actually waits on it.
pub fn start_shell(
    request: &ShellRequest,
    config: &Config,
    origin: &ConfigOrigin,
    session: &ChromeSession,
) -> Result<(), ShellError> {
    match shell_for(request, config, origin)? {
        None => Ok(()),
        Some(reference) => {
            // Relative references are resolved against this, once, so that
            // nothing downstream holds a path whose meaning depends on a
            // working directory that is about to change.
            let base = std::env::current_dir().map_err(|err| ShellError::Unreadable {
                path: ".".to_string(),
                kind: err.kind(),
                message: format!("the compositor has no working directory: {err}"),
            })?;
            let shell = resolve(&reference, &XdgDirs::from_env().shell_search_path(), &base)?;
            let runtime = runtime_from(
                std::env::var_os("DOMICILE_ELECTRON").as_deref(),
                std::env::var_os("DOMICILE_SHELL_ARGS").as_deref(),
            );
            let launch = launch_command(&shell, session, &runtime)?;
            info!(
                shell = shell.manifest.name,
                directory = ?shell.directory,
                program = ?launch.program,
                "starting the shell"
            );
            let child = Command::new(&launch.program)
                .args(&launch.args)
                .envs(launch.env.iter().map(|(key, value)| (key, value)))
                .current_dir(&launch.directory)
                .spawn()
                .map_err(|err| ShellError::CouldNotStart {
                    name: shell.manifest.name.clone(),
                    program: launch.program.to_string_lossy().into_owned(),
                    message: err.to_string(),
                })?;
            thread::spawn(move || reap(child, shell.manifest.name));
            Ok(())
        }
    }
}

/// Wait for the shell to end, and say how.
///
/// Two things, both of which the compositor otherwise gets wrong. A child
/// nobody waits on becomes a zombie for the life of the compositor — the same
/// reason `spawn_client` carries a reaper. And a shell that starts and then
/// dies produces the identical symptom to one that never started: a window with
/// no chrome in it. Failing to start is already fatal for that reason; this is
/// the other half, where carrying on is right because the socket is still
/// served and a shell can reconnect to it.
fn reap(mut child: Child, name: String) {
    match child.wait() {
        Ok(status) => warn!(
            shell = name,
            %status,
            "the shell exited; the desktop has no chrome until one reconnects"
        ),
        Err(err) => warn!(shell = name, %err, "could not wait for the shell"),
    }
}
