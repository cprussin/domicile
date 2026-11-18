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
            "click",
            "move_pointer",
            "drag",
            "scroll",
            "key",
            "type_text",
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

/// What `domicile screenshot --fit` prints for a 3840x1080 desk fit into
/// 1280 pixels: a third of its size.
const THIRD: &str =
    "{\"place\":{\"position\":[0,0],\"size\":[3840,1080]},\"width\":1280,\"height\":360}\n";

/// Stands in for `domicile`: writes a PNG for `screenshot` and records every
/// other run in `ran`.
fn desk<'a>(ran: &'a mut Vec<Vec<String>>) -> impl FnMut(&[String]) -> io::Result<Ran> + 'a {
    move |args| {
        if args[0] == "screenshot" {
            assert_eq!(args[1..3], ["--fit", "1280"]);
            std::fs::write(&args[3], b"\x89PNG").unwrap();
            printed(THIRD)
        } else {
            ran.push(args.to_vec());
            printed("")
        }
    }
}

#[test]
fn screenshot_answers_the_desk_shrunk_to_fit_and_what_it_shows() {
    let mut ran = Vec::new();
    let replies = served(&[call("screenshot", json!({}))], desk(&mut ran));
    assert_eq!(
        replies[0]["result"]["content"][0],
        json!({"type": "image", "data": "iVBORw==", "mimeType": "image/png"})
    );
    assert!(replies[0]["result"]["content"][1]["text"]
        .as_str()
        .unwrap()
        .contains("1280x360"));
}

#[test]
fn pointing_before_a_screenshot_is_a_tool_error_asking_for_one() {
    let replies = served(&[call("click", json!({"x": 1, "y": 1}))], never_run);
    assert_eq!(replies[0]["result"]["isError"], true);
    assert!(replies[0]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("screenshot"));
}

#[test]
fn pointer_tools_take_the_last_screenshots_pixels_to_the_desks() {
    let mut ran = Vec::new();
    served(
        &[
            call("screenshot", json!({})),
            call("click", json!({"x": 100, "y": 50})),
            call("click", json!({"x": 100, "y": 50, "button": "right"})),
            call("click", json!({"x": 100, "y": 50, "count": 2})),
            call("move_pointer", json!({"x": 1, "y": 2})),
            call("drag", json!({"from": [10, 10], "to": [20, 20.5]})),
            call("scroll", json!({"x": 1, "y": 1, "dx": 0, "dy": 40})),
        ],
        desk(&mut ran),
    );
    let ran: Vec<Vec<&str>> = ran
        .iter()
        .map(|args| args.iter().map(String::as_str).collect())
        .collect();
    assert_eq!(
        ran,
        [
            vec!["pointer", "300,150", "click"],
            vec!["pointer", "300,150", "right-click"],
            vec!["pointer", "300,150", "double-click"],
            vec!["pointer", "3,6"],
            vec!["pointer", "30,30", "press"],
            vec!["pointer", "60,61.5", "release"],
            vec!["pointer", "3,3"],
            vec!["scroll", "0,120"],
        ]
    );
}

#[test]
fn keys_and_text_go_to_key_and_type() {
    assert_eq!(
        ran_for("key", json!({"chord": "ctrl+l"})),
        ["key", "ctrl+l"]
    );
    assert_eq!(
        ran_for("type_text", json!({"text": "Hi there"})),
        ["type", "Hi there"]
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
