//! Opens the History app in an app window of the running desktop: `domicile
//! run-app` with the app's entry module. See `docs/HISTORY.md`.

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

use domicile_launch::components::app_module;

fn main() -> ExitCode {
    let binary = match std::env::current_exe() {
        Ok(binary) => binary,
        Err(why) => {
            eprintln!("domicile-history: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let module = match app_module(
        &binary,
        "history",
        &|name| std::env::var(name).ok(),
        &|path| path.exists(),
    ) {
        Ok(module) => module,
        Err(missing) => {
            eprintln!("domicile-history: {missing}");
            return ExitCode::FAILURE;
        }
    };
    let domicile = binary.with_file_name("domicile");
    let why = Command::new(&domicile).arg("run-app").arg(module).exec();
    eprintln!(
        "domicile-history: could not run {}: {why}",
        domicile.display()
    );
    ExitCode::FAILURE
}
