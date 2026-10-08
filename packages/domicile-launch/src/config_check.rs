//! `domicile check-config`: whether the compositor takes a config file.
//!
//! The home-manager module runs it on the file it writes, so a config the
//! compositor refuses fails the build instead of the desk.

use std::path::Path;

use domicile_config::Config;

use crate::config_path::is_module;

/// Parses `config` as the compositor does, or says why it refuses it.
///
/// A module config is refused: `domicile` builds it to JSON when it runs, so
/// there is no JSON to check yet.
pub fn check(config: &Path) -> Result<(), String> {
    if is_module(config) {
        return Err(format!(
            "{} is a module; check-config reads a JSON config",
            config.display()
        ));
    }
    Config::load(config)
        .map(|_| ())
        .map_err(|why| why.to_string())
}
