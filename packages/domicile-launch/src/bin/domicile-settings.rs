//! Opens the Settings app in an app window of the running desktop: `domicile
//! open --app` with the app's entry module. `domicile-settings <page>` opens
//! it on that page, such as `privacy`, as the module's `#<page>`. See
//! `docs/SETTINGS.md`.

use std::process::ExitCode;

use domicile_launch::components::open_own_app;

fn main() -> ExitCode {
    open_own_app("domicile-settings", "settings", std::env::args_os().nth(1))
}
