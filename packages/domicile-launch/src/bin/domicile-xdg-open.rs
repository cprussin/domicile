//! The desktop's `xdg-open`: opens links with `domicile open-url` and passes
//! anything else to the next `xdg-open` on `PATH`.
//!
//! `domicile_launch::spawn` puts this first on every app's `PATH`. The logic is
//! in `domicile_launch::xdg_open`.

use std::os::unix::process::CommandExt as _;
use std::process::{Command, ExitCode};

use domicile_launch::xdg_open::{link, underlying};

fn main() -> ExitCode {
    let me = match std::env::current_exe() {
        Ok(me) => me,
        Err(why) => {
            eprintln!("xdg-open: cannot find myself: {why}");
            return ExitCode::FAILURE;
        }
    };
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let (program, why) = match link(&args) {
        Some(url) => {
            let domicile = me.with_file_name("domicile");
            let why = Command::new(&domicile).arg("open-url").arg(url).exec();
            (domicile, why)
        }
        None => {
            // `current_exe` resolves symlinks, so compare canonical paths to
            // skip this program.
            let found = underlying(std::env::var("PATH").ok().as_deref(), &|candidate| {
                candidate
                    .canonicalize()
                    .is_ok_and(|resolved| resolved != me)
            });
            let Some(found) = found else {
                eprintln!(
                    "xdg-open: this desktop opens links itself, and there is no other \
                     xdg-open on PATH for anything else"
                );
                return ExitCode::FAILURE;
            };
            let why = Command::new(&found).args(&args).exec();
            (found, why)
        }
    };
    eprintln!("xdg-open: could not run {}: {why}", program.display());
    ExitCode::FAILURE
}
