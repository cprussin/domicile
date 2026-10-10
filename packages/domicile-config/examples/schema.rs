//! Prints the config's JSON Schema.
//!
//! `packages/chrome-sdk/config.schema.json` is this output, and the SDK's
//! config types are generated from it:
//!
//! ```sh
//! cargo run -q -p domicile-config --example schema > packages/chrome-sdk/config.schema.json
//! ```

fn main() {
    let schema = schemars::schema_for!(domicile_config::Config);
    println!(
        "{}",
        serde_json::to_string_pretty(&schema).expect("a schema is JSON")
    );
}
