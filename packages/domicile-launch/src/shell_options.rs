//! Checks the values a config gives its shell's options against the
//! declaration the shell wrote to `options.json`. The SDK's `readOptions`
//! drops the same values in the shell, in the same words. See
//! `docs/WRITING-A-SHELL.md#options`.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Map, Value};

/// One declared option, as far as checking a value needs. Labels and
/// defaults are ignored.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Declared {
    Toggle,
    Choice { choices: Vec<String> },
    Number { min: Option<f64>, max: Option<f64> },
    Text,
    List,
    Group { options: BTreeMap<String, Declared> },
}

/// Each value in `given` that the declaration `declared` refuses, as
/// `where: value problem`, sorted. Refuses a `declared` that is not a
/// declaration.
pub fn problems(declared: &str, given: &Map<String, Value>) -> Result<Vec<String>, String> {
    let declared: BTreeMap<String, Declared> = serde_json::from_str(declared)
        .map_err(|why| format!("the shell's options.json is not a declaration: {why}"))?;
    let mut found = group_problems(&declared, given, "");
    found.sort();
    Ok(found)
}

fn group_problems(
    declared: &BTreeMap<String, Declared>,
    given: &Map<String, Value>,
    at: &str,
) -> Vec<String> {
    given
        .iter()
        .flat_map(|(key, value)| {
            let here = format!("{at}{key}");
            match (declared.get(key), value) {
                (None, _) => vec![format!("{here}: no such option")],
                (Some(Declared::Group { options }), Value::Object(inner)) => {
                    group_problems(options, inner, &format!("{here}."))
                }
                (Some(Declared::Group { .. }), other) => {
                    vec![format!("{here}: {other} is not a group of options")]
                }
                (Some(option), value) => value_problem(option, value)
                    .map(|problem| format!("{here}: {value} {problem}"))
                    .into_iter()
                    .collect(),
            }
        })
        .collect()
}

/// What is wrong with `value` for `option`, or `None` if nothing is.
fn value_problem(option: &Declared, value: &Value) -> Option<String> {
    match (option, value) {
        (Declared::Toggle, Value::Bool(_)) => None,
        (Declared::Toggle, _) => Some("is not true or false".to_string()),
        (Declared::Choice { choices }, Value::String(choice)) if choices.contains(choice) => None,
        (Declared::Choice { choices }, _) => Some(format!("is not one of {}", choices.join(", "))),
        (Declared::Number { min, max }, Value::Number(number)) => {
            let number = number
                .as_f64()
                .expect("a JSON number is an f64 without arbitrary precision");
            match (min, max) {
                (Some(min), _) if number < *min => Some(format!("is below {min}")),
                (_, Some(max)) if number > *max => Some(format!("is above {max}")),
                _ => None,
            }
        }
        (Declared::Number { .. }, _) => Some("is not a number".to_string()),
        (Declared::Text, Value::String(_)) => None,
        (Declared::Text, _) => Some("is not text".to_string()),
        (Declared::List, Value::Array(items)) if items.iter().all(Value::is_string) => None,
        (Declared::List, _) => Some("is not a list of text".to_string()),
        (Declared::Group { .. }, _) => unreachable!("a group's values are checked as a group"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECLARED: &str = r#"{
      "seconds": { "kind": "toggle", "label": "Show seconds", "default": false },
      "gaps": { "kind": "number", "label": "Gaps", "default": 8, "min": 0, "max": 64 },
      "greeting": { "kind": "text", "label": "Greeting", "default": "hello" },
      "hidden": { "kind": "list", "label": "Hidden apps", "default": [] }
    }"#;

    fn given(value: Value) -> Map<String, Value> {
        let Value::Object(map) = value else {
            unreachable!("the fixtures are objects")
        };
        map
    }

    #[test]
    fn each_kind_refuses_what_the_sdk_drops_in_its_words() {
        assert_eq!(
            problems(
                DECLARED,
                &given(serde_json::json!({
                    "seconds": "yes",
                    "gaps": -1,
                    "greeting": 3,
                    "hidden": [1],
                }))
            ),
            Ok(vec![
                "gaps: -1 is below 0".to_string(),
                "greeting: 3 is not text".to_string(),
                "hidden: [1] is not a list of text".to_string(),
                "seconds: \"yes\" is not true or false".to_string(),
            ])
        );
    }

    #[test]
    fn values_the_declaration_takes_have_no_problems() {
        assert_eq!(
            problems(
                DECLARED,
                &given(serde_json::json!({
                    "seconds": true,
                    "gaps": 64,
                    "greeting": "hi",
                    "hidden": ["a"],
                }))
            ),
            Ok(vec![])
        );
    }

    #[test]
    fn a_declaration_that_does_not_parse_is_refused() {
        assert!(problems("[]", &Map::new()).is_err());
    }
}
