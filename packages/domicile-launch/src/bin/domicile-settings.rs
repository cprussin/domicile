//! Opens the Settings app in an app window of the running desktop: `domicile
//! open --app` with the app's entry module. `domicile-settings <page>` opens
//! it on that page, such as `privacy`, as the module's `#<page>`. See
//! `docs/SETTINGS.md`.

#![allow(
    clippy::print_stderr,
    reason = "a command: what it says on stderr is for the person or program that ran it"
)]

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

use domicile_launch::components::app_module;

fn main() -> ExitCode {
    let binary = match std::env::current_exe() {
        Ok(binary) => binary,
        Err(why) => {
            eprintln!("domicile-settings: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let module = match app_module(
        &binary,
        "settings",
        &|name| std::env::var(name).ok(),
        &|path| path.exists(),
    ) {
        Ok(module) => module,
        Err(missing) => {
            eprintln!("domicile-settings: {missing}");
            return ExitCode::FAILURE;
        }
    };
    // The app reads the page from its address, and opens on its first page
    // when it names none it has.
    let mut target = module.into_os_string();
    if let Some(page) = std::env::args_os().nth(1) {
        target.push("#");
        target.push(page);
    }
    let domicile = binary.with_file_name("domicile");
    let why = Command::new(&domicile)
        .arg("open")
        .arg("--app")
        .arg(target)
        .exec();
    eprintln!(
        "domicile-settings: could not run {}: {why}",
        domicile.display()
    );
    ExitCode::FAILURE
}
