//! Temporary changes laid over the config as written: the Settings app's and
//! a shell's changes to a config the desktop cannot write. They live in the
//! compositor and end with it. See `docs/SETTINGS.md#temporary-changes`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One step from the top of a config down to a value: a key, or an index into
/// a list.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ConfigKey {
    Index(usize),
    Name(String),
}

/// A temporary change: `value` in place of what the config has at `path`.
/// `null` takes the setting back to its default.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct ConfigOverride {
    pub path: Vec<ConfigKey>,
    pub value: Value,
}

/// The value at `path` in `written`, or `None` where it has none.
pub(crate) fn value_at<'a>(written: &'a Value, path: &[ConfigKey]) -> Option<&'a Value> {
    path.iter().try_fold(written, |at, key| match key {
        ConfigKey::Name(name) => at.as_object()?.get(name),
        ConfigKey::Index(index) => at.as_array()?.get(*index),
    })
}

/// Whether `path` reaches no further than one past the end of each list it
/// steps into in `config`, so a change can add to a list but not pad it.
/// Says which step goes too far.
pub(crate) fn within_reach(config: &Value, path: &[ConfigKey]) -> Result<(), String> {
    path.iter()
        .enumerate()
        .try_fold(Some(config), |at, (step, key)| match key {
            ConfigKey::Name(name) => Ok(at.and_then(|at| at.as_object()?.get(name))),
            ConfigKey::Index(index) => {
                let len = at.and_then(Value::as_array).map_or(0, Vec::len);
                match *index <= len {
                    true => Ok(at.and_then(|at| at.as_array()?.get(*index))),
                    false => Err(format!(
                        "step {step} of the path is index {index}, past the end of a list of {len}"
                    )),
                }
            }
        })
        .map(|_| ())
}

/// `written` with each override's value at its path, in order. `null` removes
/// the key. Missing sections are made, and a list is padded with `null`s up
/// to an index past its end.
pub(crate) fn overridden(written: &Value, overrides: &[ConfigOverride]) -> Value {
    overrides
        .iter()
        .fold(written.clone(), |mut config, change| {
            put(&mut config, &change.path, &change.value);
            config
        })
}

/// Puts `value` at `path` under `at`.
fn put(at: &mut Value, path: &[ConfigKey], value: &Value) {
    match path {
        [] => *at = value.clone(),
        [ConfigKey::Name(name), rest @ ..] => {
            if !at.is_object() {
                *at = Value::Object(serde_json::Map::new());
            }
            let object = at.as_object_mut().expect("made an object above");
            match (rest.is_empty(), value.is_null()) {
                (true, true) => {
                    object.remove(name);
                }
                _ => put(
                    object.entry(name.clone()).or_insert(Value::Null),
                    rest,
                    value,
                ),
            }
        }
        [ConfigKey::Index(index), rest @ ..] => {
            if !at.is_array() {
                *at = Value::Array(Vec::new());
            }
            let list = at.as_array_mut().expect("made a list above");
            if list.len() <= *index {
                list.resize(index + 1, Value::Null);
            }
            put(&mut list[*index], rest, value);
        }
    }
}
