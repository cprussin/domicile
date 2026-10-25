//! The desktop's `xdg-open`: `domicile open` on its one argument, so a file or
//! link an app opens goes where the launcher would send it.
//!
//! `domicile_launch::spawn` puts this first on every app's `PATH`. The logic is
//! in `domicile_launch::open`.

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let me = match std::env::current_exe() {
        Ok(me) => me,
        Err(why) => {
            eprintln!("xdg-open: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let [target] = args.as_slice() else {
        eprintln!(
            "xdg-open: takes one file, folder or address to open, and was given {}",
            args.len()
        );
        return ExitCode::FAILURE;
    };
    let domicile = me.with_file_name("domicile");
    let why = Command::new(&domicile).arg("open").arg(target).exec();
    eprintln!("xdg-open: could not run {}: {why}", domicile.display());
    ExitCode::FAILURE
}
