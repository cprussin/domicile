//! Tests for `domicile mcp`: the Model Context Protocol server over stdio.

use std::io;

use domicile_launch::mcp::{serve, Ran};
use serde_json::{json, Value};

/// Serves `requests`, one JSON-RPC message per line, with `domicile` standing
/// in for the `domicile` binary, and returns each reply.
fn served(requests: &[Value], domicile: impl FnMut(&[String]) -> io::Result<Ran>) -> Vec<Value> {
    let input: String = requests
        .iter()
        .map(|request| format!("{request}\n"))
        .collect();
    let mut output = Vec::new();
    serve(input.as_bytes(), &mut output, domicile).unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn printed(stdout: &str) -> io::Result<Ran> {
    Ok(Ran {
        success: true,
        stdout: stdout.to_string(),
        stderr: String::new(),
    })
}

fn never_run(args: &[String]) -> io::Result<Ran> {
    panic!("ran domicile {args:?}")
}

fn call(name: &str, arguments: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments}
    })
}

/// The arguments one tool call runs `domicile` with.
fn ran_for(name: &str, arguments: Value) -> Vec<String> {
    let mut ran = Vec::new();
    served(&[call(name, arguments)], |args| {
        ran = args.to_vec();
        printed("")
    });
    ran
}

#[test]
fn initialize_names_the_server_and_offers_tools() {
    let replies = served(
        &[json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}
        })],
        never_run,
    );
    assert_eq!(replies[0]["id"], 0);
    assert_eq!(replies[0]["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "domicile");
    assert!(replies[0]["result"]["capabilities"]["tools"].is_object());
}

#[test]
fn initialize_offers_its_own_version_for_one_it_does_not_speak() {
    let replies = served(
        &[json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {"protocolVersion": "1999-01-01", "capabilities": {}}
        })],
        never_run,
    );
    assert_eq!(replies[0]["result"]["protocolVersion"], "2025-06-18");
}

#[test]
fn notifications_get_no_reply() {
    let replies = served(
        &[
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json!({"jsonrpc": "2.0", "id": 7, "method": "ping"}),
        ],
        never_run,
    );
    assert_eq!(
        replies,
        vec![json!({"jsonrpc": "2.0", "id": 7, "result": {}})]
    );
}

#[test]
fn tools_list_describes_each_tool() {
    let replies = served(
        &[json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})],
        never_run,
    );
    let tools = replies[0]["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "list_windows",
            "list_displays",
            "list_inputs",
            "status",
            "list_shell_commands",
            "list_bindings",
            "send_shell",
            "open",
            "focus_window",
            "close_window",
            "theme",
            "screenshot",
        ]
    );
    for tool in tools {
        assert!(tool["description"].is_string(), "{tool}");
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
    }
}

#[test]
fn a_listing_runs_its_verb_for_json_and_answers_what_it_printed() {
    let mut ran = Vec::new();
    let replies = served(&[call("list_windows", json!({}))], |args| {
        ran = args.to_vec();
        printed("[{\"title\":\"notes.org\"}]\n")
    });
    assert_eq!(ran, ["list-windows", "--json"]);
    assert_eq!(
        replies[0]["result"],
        json!({
            "content": [{"type": "text", "text": "[{\"title\":\"notes.org\"}]\n"}],
            "isError": false
        })
    );
}

#[test]
fn a_failed_command_is_a_tool_error_saying_why() {
    let replies = served(&[call("focus_window", json!({"id": "abc"}))], |_| {
        Ok(Ran {
            success: false,
            stdout: String::new(),
            stderr: "domicile: no window abc\n".to_string(),
        })
    });
    assert_eq!(replies[0]["result"]["isError"], true);
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "domicile: no window abc\n"
    );
}

#[test]
fn send_shell_passes_its_words() {
    assert_eq!(
        ran_for("send_shell", json!({"words": ["focus", "left"]})),
        ["send-shell", "focus", "left"]
    );
}

#[test]
fn open_takes_an_app_flag_and_a_profile() {
    assert_eq!(
        ran_for("open", json!({"target": "https://example.com"})),
        ["open", "https://example.com"]
    );
    assert_eq!(
        ran_for(
            "open",
            json!({"target": "https://example.com", "app": true, "profile": "work"})
        ),
        ["open", "--app", "--profile", "work", "https://example.com"]
    );
}

#[test]
fn window_actions_take_the_window_id() {
    assert_eq!(
        ran_for("close_window", json!({"id": "abc"})),
        ["close-window", "abc"]
    );
}

#[test]
fn theme_with_no_change_prints_it() {
    assert_eq!(ran_for("theme", json!({})), ["theme"]);
    assert_eq!(
        ran_for("theme", json!({"change": "dark"})),
        ["theme", "dark"]
    );
}

#[test]
fn screenshot_answers_the_png_domicile_wrote() {
    let replies = served(&[call("screenshot", json!({}))], |args| {
        assert_eq!(args[0], "screenshot");
        std::fs::write(&args[1], b"\x89PNG").unwrap();
        printed("")
    });
    assert_eq!(
        replies[0]["result"],
        json!({
            "content": [{"type": "image", "data": "iVBORw==", "mimeType": "image/png"}],
            "isError": false
        })
    );
}

#[test]
fn a_missing_argument_is_a_tool_error_naming_it() {
    let replies = served(&[call("focus_window", json!({}))], never_run);
    assert_eq!(replies[0]["result"]["isError"], true);
    assert!(replies[0]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("id"));
}

#[test]
fn an_unknown_tool_is_an_invalid_params_error() {
    let replies = served(&[call("power_off", json!({}))], never_run);
    assert_eq!(replies[0]["error"]["code"], -32602);
}

#[test]
fn an_unknown_method_is_method_not_found() {
    let replies = served(
        &[json!({"jsonrpc": "2.0", "id": 3, "method": "resources/list"})],
        never_run,
    );
    assert_eq!(replies[0]["id"], 3);
    assert_eq!(replies[0]["error"]["code"], -32601);
}

#[test]
fn a_line_that_is_not_json_is_a_parse_error() {
    let mut output = Vec::new();
    serve("{not json\n".as_bytes(), &mut output, never_run).unwrap();
    let reply: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(reply["id"], Value::Null);
    assert_eq!(reply["error"]["code"], -32700);
}

#[test]
fn arguments_that_are_not_an_object_are_a_tool_error() {
    let replies = served(&[call("list_windows", json!("all"))], never_run);
    assert_eq!(replies[0]["result"]["isError"], true);
}
