//! Opens the History app in an app window of the running desktop: `domicile
//! open --app` with the app's entry module. See `docs/HISTORY.md`.

use std::process::ExitCode;

use domicile_launch::components::open_own_app;

fn main() -> ExitCode {
    open_own_app("domicile-history", "history", None)
}
