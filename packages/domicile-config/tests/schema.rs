//! The config's JSON Schema, which editors and the SDK's generated types read.
//!
//! Fields that parse through `try_from` must describe what is written, not the
//! type they parse into.

use domicile_config::Config;
use serde_json::{json, Value};

fn schema() -> Value {
    serde_json::to_value(schemars::schema_for!(Config)).expect("a schema is JSON")
}

#[test]
fn the_schema_refuses_keys_the_config_refuses() {
    assert_eq!(schema()["additionalProperties"], json!(false));
}

#[test]
fn an_accent_color_is_written_as_a_hex_string() {
    let schema = schema();
    let color = &schema["$defs"]["AccentColor"];
    assert_eq!(color["type"], json!("string"), "{color}");
    assert_eq!(color["pattern"], json!("^#[0-9a-fA-F]{6}$"), "{color}");
}

#[test]
fn files_to_omit_are_written_as_a_list_of_globs() {
    let schema = schema();
    let omit = &schema["$defs"]["FilesOmit"];
    assert_eq!(omit["type"], json!("array"), "{omit}");
    assert_eq!(omit["items"], json!({ "type": "string" }), "{omit}");
}
