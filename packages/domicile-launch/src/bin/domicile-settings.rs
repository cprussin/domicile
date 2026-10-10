//! Opens the Settings app in a browser window of the running desktop: `domicile
//! open-url` with the app's page. See `domicile_launch::apps`.

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

use domicile_launch::apps::SETTINGS;

fn main() -> ExitCode {
    let binary = match std::env::current_exe() {
        Ok(binary) => binary,
        Err(why) => {
            eprintln!("domicile-settings: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let domicile = binary.with_file_name("domicile");
    let why = Command::new(&domicile).arg("open-url").arg(SETTINGS).exec();
    eprintln!(
        "domicile-settings: could not run {}: {why}",
        domicile.display()
    );
    ExitCode::FAILURE
}
