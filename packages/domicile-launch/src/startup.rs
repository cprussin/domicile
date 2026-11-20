//! The one line a desktop prints when it is up, off a terminal: what it
//! chose, as a terminal's startup block shows it, and where to reach it.
//! Scripts wait for its start, `domicile is up.`, and read `DOMICILE_SOCK=`
//! from its end.

use std::path::Path;

use crate::control_socket::VARIABLE;

/// What a desktop started with.
#[derive(Debug, Clone, Copy)]
pub struct Chosen<'a> {
    /// The first line of `--version`, when it reads.
    pub version: Option<&'a str>,
    pub shell: &'a Path,
    pub config: &'a str,
    pub profile: &'a Path,
    pub platform: &'a str,
    pub on_the_cpu: bool,
    /// The control socket.
    pub socket: &'a Path,
}

/// The line that says the desktop is up.
pub fn up_line(started: &Chosen) -> String {
    let facts: Vec<String> = started
        .version
        .map(str::to_string)
        .into_iter()
        .chain([
            format!("shell {}", started.shell.display()),
            format!("config {}", started.config),
            format!("profile {}", started.profile.display()),
            format!("platform {}", started.platform),
        ])
        .chain(
            started
                .on_the_cpu
                .then(|| "the engine composites on the CPU".to_string()),
        )
        .chain([format!("{VARIABLE}={}", started.socket.display())])
        .collect();
    format!("domicile is up. {}", facts.join(" · "))
}
