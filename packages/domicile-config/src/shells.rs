//! What the config says to one shell in particular.
//!
//! One file holds every shell a desk may load — `domicile load-shell` swaps
//! the page and not the config — so a shell's own keys and settings sit under
//! its name, `[shells.manganese]`, and the shell picks its own out.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::keybindings::{self, Bindings};
use crate::ConfigError;

/// `[shells.<name>]`.
///
/// Compared, which is what `PartialEq` is for: a reload asks what moved, and a
/// shell's keys are one of the answers — see the compositor's `Restatement`.
/// Not `Eq`, because `options` can hold a float.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ShellConfig {
    /// This shell's bindings in mode `default`, over `[keybindings]`.
    pub keybindings: Bindings,
    /// This shell's modes, beside `[modes]`.
    pub modes: BTreeMap<String, Bindings>,
    /// Whatever the shell reads, forwarded to it as JSON and read by nothing
    /// here: the shell owns its own settings, and a schema for them in this
    /// crate would be a second definition of them.
    pub options: toml::Table,
}

impl ShellConfig {
    /// `top_modes` is `[modes]`, which every shell can switch to as well as
    /// its own.
    pub(crate) fn validate(
        &self,
        name: &str,
        top_modes: &BTreeMap<String, Bindings>,
    ) -> Result<(), ConfigError> {
        let at = format!("shells.{name}.");
        keybindings::validate(&at, &self.keybindings, &self.modes, |mode| {
            top_modes.contains_key(mode) || self.modes.contains_key(mode)
        })?;
        // JSON has no spelling for these, and anything the compositor sent in
        // their place would be a value the shell never wrote.
        if self.options.values().any(not_json) {
            return Err(ConfigError::Validation(format!(
                "[{at}options] holds a `nan` or `inf`, which the shell is handed as \
                 JSON and JSON cannot carry"
            )));
        }
        Ok(())
    }
}

/// Whether `value` holds a float JSON has no number for, at any depth.
fn not_json(value: &toml::Value) -> bool {
    match value {
        toml::Value::Float(float) => !float.is_finite(),
        toml::Value::Array(values) => values.iter().any(not_json),
        toml::Value::Table(table) => table.values().any(not_json),
        toml::Value::String(_)
        | toml::Value::Integer(_)
        | toml::Value::Boolean(_)
        | toml::Value::Datetime(_) => false,
    }
}
