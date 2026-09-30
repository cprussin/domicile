//! `domicile-open-url <url>` — `domicile open-url <url>`, as one program.
//!
//! What `BROWSER` names inside a desktop (see `domicile_launch::spawn`). Much
//! of what reads that variable runs it as a single word, so `domicile
//! open-url` cannot go in it; this is that command under a name of its own.
//! It execs `domicile` beside it rather than carrying the command's code a
//! second time.

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
