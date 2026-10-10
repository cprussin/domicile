//! Opens the History app in an app window of the running desktop: `domicile
//! open-app` with the app's page. See `domicile_launch::apps`.

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

use domicile_launch::apps::HISTORY;

fn main() -> ExitCode {
    let binary = match std::env::current_exe() {
        Ok(binary) => binary,
        Err(why) => {
            eprintln!("domicile-history: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let domicile = binary.with_file_name("domicile");
    let why = Command::new(&domicile).arg("open-app").arg(HISTORY).exec();
    eprintln!(
        "domicile-history: could not run {}: {why}",
        domicile.display()
    );
    ExitCode::FAILURE
}
