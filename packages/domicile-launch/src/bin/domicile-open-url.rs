//! Runs `domicile open-url` as a single program, for use as `BROWSER`.
//!
//! Many programs run `BROWSER` as one word, so it cannot hold a subcommand.
//! See `domicile_launch::spawn`.

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let binary = match std::env::current_exe() {
        Ok(binary) => binary,
        Err(why) => {
            eprintln!("domicile-open-url: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let domicile = binary.with_file_name("domicile");
    let why = Command::new(&domicile)
        .arg("open-url")
        .args(std::env::args_os().skip(1))
        .exec();
    eprintln!(
        "domicile-open-url: could not run {}: {why}",
        domicile.display()
    );
    ExitCode::FAILURE
}
