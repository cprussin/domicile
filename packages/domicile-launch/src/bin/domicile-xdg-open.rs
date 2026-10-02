//! `xdg-open`, inside a desktop: a link is `domicile open-url`, and anything
//! else is the `xdg-open` this one stands in front of.
//!
//! The desktop links this into a directory first on every app's `PATH` — see
//! `domicile_launch::spawn` — and the decisions are
//! `domicile_launch::xdg_open`'s.

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
            // `current_exe` resolves the link this was run through, so this
            // program is recognized by where it really is.
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
