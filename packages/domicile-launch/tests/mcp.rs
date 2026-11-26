//! Tests for `domicile mcp`: the Model Context Protocol server over stdio.

use std::cell::{Cell, RefCell};
use std::io::{self, BufReader, Cursor, Write};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use domicile_launch::accessibility::MOST;
use domicile_launch::mcp::{serve, Grant, Ran, LET_GO_AFTER};
use domicile_protocol::{AgentReach, AgentWindow, WindowKind};
use serde_json::{json, Value};

/// Serves `requests`, one JSON-RPC message per line, with `domicile` standing
/// in for the `domicile` binary, and returns each reply. The user lets the
/// agent reach the whole desk.
fn served(requests: &[Value], domicile: impl FnMut(&[String]) -> io::Result<Ran>) -> Vec<Value> {
    served_letting(requests, domicile, |_| Ok(reaching(AgentReach::Desk).0))
}

/// [`served`], letting the agent in as `admit` says.
fn served_letting(
    requests: &[Value],
    domicile: impl FnMut(&[String]) -> io::Result<Ran>,
    admit: impl FnMut(&str) -> Result<Grant, String>,
) -> Vec<Value> {
    let input: String = requests
        .iter()
        .map(|request| format!("{request}\n"))
        .collect();
    let mut output = Vec::new();
    serve(
        Cursor::new(input.into_bytes()),
        &mut output,
        domicile,
        admit,
        LET_GO_AFTER,
    )
    .unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn refused(stderr: &str) -> io::Result<Ran> {
    Ok(Ran {
        success: false,
        stdout: String::new(),
        stderr: stderr.to_string(),
    })
}

fn printed(stdout: &str) -> io::Result<Ran> {
    Ok(Ran {
        success: true,
        stdout: stdout.to_string(),
        stderr: String::new(),
    })
}

/// What `domicile idle-time --json` prints when the user last used this
/// computer's own keyboard or pointer `seconds` ago.
fn idle_for(seconds: u64) -> io::Result<Ran> {
    printed(&format!("{{\"seconds\":0,\"local_seconds\":{seconds}}}\n"))
}

/// Long enough away that the tools that move the user's pointer and focus
/// run.
const AWAY: u64 = 3600;

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

/// The arguments one tool call first runs `domicile` with.
fn ran_for(name: &str, arguments: Value) -> Vec<String> {
    let mut ran = Vec::new();
    served(&[call(name, arguments)], |args| {
        if args[0] == "idle-time" {
            return idle_for(AWAY);
        }
        if ran.is_empty() {
            ran = args.to_vec();
        }
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
    // Agents read windows as text first, which is quicker and smaller than
    // looking at the desk.
    let instructions = replies[0]["result"]["instructions"].as_str().unwrap();
    for tool in [
        "list_windows",
        "browser_snapshot",
        "app_snapshot",
        "screenshot",
    ] {
        assert!(instructions.contains(tool), "{instructions}");
    }
    // Agents let go whenever they wait on anything else, so the user's bar
    // never shows an agent that isn't working.
    assert!(
        instructions.contains("Before you wait on anything else"),
        "{instructions}"
    );
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
            "exec",
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
            "browser_snapshot",
            "browser_click",
            "browser_drag",
            "browser_scroll",
            "browser_type",
            "browser_key",
            "browser_navigate",
            "browser_screenshot",
            "browser_choose_files",
            "app_snapshot",
            "app_click",
            "app_focus",
            "app_set_text",
            "ask_to_use_desktop",
            "stop_using_desktop",
            "batch",
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
    let replies = served(&[call("focus_window", json!({"id": "abc"}))], |args| {
        if args[0] == "idle-time" {
            return idle_for(AWAY);
        }
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
fn send_shell_on_a_window_takes_it_with_the_agents_keyboard_then_aims_at_it() {
    // A command on the agent's own window moves nothing of the user's, so it
    // doesn't wait for them.
    let mut ran = Vec::new();
    let replies = served(
        &[call(
            "send_shell",
            json!({"words": ["move", "container", "to", "workspace", "3"], "window": "n1"}),
        )],
        |args: &[String]| match args[0].as_str() {
            "idle-time" => panic!("a command on the agent's own window waited for the user"),
            _ => desk(&mut ran)(args),
        },
    );
    assert_eq!(replies[0]["result"]["isError"], false, "{replies:?}");
    assert_eq!(
        ran,
        [
            vec!["focus-window", "--agent", "7", "n1"],
            vec![
                "send-shell",
                "--agent",
                "7",
                "--window",
                "n1",
                "move",
                "container",
                "to",
                "workspace",
                "3"
            ],
        ]
    );
}

#[test]
fn send_shell_on_a_window_the_agent_cant_take_says_why() {
    let replies = served(
        &[call(
            "send_shell",
            json!({"words": ["kill"], "window": "n1"}),
        )],
        |args: &[String]| match args[0].as_str() {
            "focus-window" => refused("the user is using window n1"),
            other => panic!("ran {other} after the window was refused"),
        },
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "the user is using window n1"
    );
}

#[test]
fn exec_runs_its_argv_for_the_agents_seat() {
    assert_eq!(
        ran_for("exec", json!({"argv": ["kitty", "--hold", "btop"]})),
        ["exec", "--agent", "7", "kitty", "--hold", "btop"]
    );
}

#[test]
fn open_takes_an_app_flag_and_a_profile_for_the_agents_seat() {
    assert_eq!(
        ran_for("open", json!({"target": "https://example.com"})),
        ["open", "--agent", "7", "https://example.com"]
    );
    assert_eq!(
        ran_for(
            "open",
            json!({"target": "https://example.com", "app": true, "profile": "work"})
        ),
        [
            "open",
            "--agent",
            "7",
            "--app",
            "--profile",
            "work",
            "https://example.com"
        ]
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

/// What `domicile screenshot --fit` prints for the desk's area 300,150
/// 600x300, which fits.
const ZOOMED: &str =
    "{\"place\":{\"position\":[300,150],\"size\":[600,300]},\"width\":600,\"height\":300}\n";

/// Stands in for `domicile`: writes a PNG for `screenshot` and records every
/// other run in `ran`, and each `--area` asked for.
fn desk<'a>(ran: &'a mut Vec<Vec<String>>) -> impl FnMut(&[String]) -> io::Result<Ran> + 'a {
    move |args| {
        if args[0] == "idle-time" {
            idle_for(AWAY)
        } else if args[0] == "screenshot" {
            assert_eq!(args[1..3], ["--fit", "1280"]);
            std::fs::write(args.last().unwrap(), b"\x89PNG").unwrap();
            match &args[3..] {
                [_] => printed(THIRD),
                [flag, area, _] if flag == "--area" => {
                    ran.push(vec![flag.clone(), area.clone()]);
                    printed(ZOOMED)
                }
                _ => panic!("ran domicile {args:?}"),
            }
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
            vec!["pointer", "--agent", "7", "300,150", "click"],
            vec!["pointer", "--agent", "7", "300,150", "right-click"],
            vec!["pointer", "--agent", "7", "300,150", "double-click"],
            vec!["pointer", "--agent", "7", "3,6"],
            vec!["drag", "--agent", "7", "30,30", "60,61.5"],
            vec!["pointer", "--agent", "7", "3,3"],
            vec!["scroll", "--agent", "7", "0,120"],
        ]
    );
}

#[test]
fn a_screenshot_of_an_area_of_the_last_zooms_in_and_points_go_there() {
    let mut ran = Vec::new();
    let replies = served(
        &[
            call("screenshot", json!({})),
            call("screenshot", json!({"area": [100, 50, 200, 100]})),
            call("click", json!({"x": 10, "y": 10})),
        ],
        desk(&mut ran),
    );
    assert!(replies[1]["result"]["content"][1]["text"]
        .as_str()
        .unwrap()
        .contains("600x300"));
    assert_eq!(
        ran,
        [
            vec!["--area".to_string(), "300,150,600x300".to_string()],
            ["pointer", "--agent", "7", "310,160", "click"]
                .map(str::to_string)
                .to_vec(),
        ]
    );
    let replies = served(
        &[call("screenshot", json!({"area": [0, 0, 10, 10]}))],
        never_run,
    );
    assert_eq!(replies[0]["result"]["isError"], true);
}

#[test]
fn keys_and_text_go_to_key_and_type() {
    assert_eq!(
        ran_for("key", json!({"chord": "ctrl+l"})),
        ["key", "--agent", "7", "ctrl+l"]
    );
    assert_eq!(
        ran_for("type_text", json!({"text": "Hi there"})),
        ["type", "--agent", "7", "Hi there"]
    );
    assert_eq!(
        ran_for("focus_window", json!({"id": "n1"})),
        ["focus-window", "--agent", "7", "n1"]
    );
}

/// Each tool that points or types on the agent's own seat, with arguments it
/// takes after a screenshot.
fn on_its_own_seat() -> [(&'static str, Value); 7] {
    [
        ("click", json!({"x": 1, "y": 1})),
        ("move_pointer", json!({"x": 1, "y": 1})),
        ("drag", json!({"from": [1, 1], "to": [2, 2]})),
        ("scroll", json!({"x": 1, "y": 1, "dx": 0, "dy": 1})),
        ("key", json!({"chord": "ctrl+l"})),
        ("type_text", json!({"text": "hi"})),
        ("focus_window", json!({"id": "n1"})),
    ]
}

/// Each tool that moves the user's pointer, keyboard focus or windows.
fn moving_the_users_hands() -> [(&'static str, Value); 1] {
    [("send_shell", json!({"words": ["focus", "left"]}))]
}

#[test]
fn tools_on_the_agents_own_seat_run_while_the_user_uses_the_desktop() {
    for (name, arguments) in on_its_own_seat() {
        let mut ran = Vec::new();
        let replies = served(
            &[call("screenshot", json!({})), call(name, arguments)],
            |args: &[String]| match args[0].as_str() {
                "idle-time" => panic!("{name} waited for the user"),
                _ => desk(&mut ran)(args),
            },
        );
        assert_eq!(replies[1]["result"]["isError"], false, "{name}");
        assert!(
            ran.iter().all(|args| args[1..3] == ["--agent", "7"]),
            "{name} ran {ran:?}"
        );
    }
}

#[test]
fn tools_that_move_the_users_pointer_or_focus_wait_while_they_use_the_desktop() {
    for (name, arguments) in moving_the_users_hands() {
        let mut ran = Vec::new();
        let replies = served(
            &[call("screenshot", json!({})), call(name, arguments)],
            |args: &[String]| match args[0].as_str() {
                "idle-time" => idle_for(29),
                _ => desk(&mut ran)(args),
            },
        );
        assert_eq!(replies[1]["result"]["isError"], true, "{name}");
        let text = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("browser_ and app_"), "{name}: {text}");
        assert!(ran.is_empty(), "{name} ran {ran:?}");
    }
}

#[test]
fn tools_that_move_the_users_pointer_or_focus_run_once_they_step_away() {
    for (name, arguments) in moving_the_users_hands() {
        let mut ran = Vec::new();
        let replies = served(
            &[call("screenshot", json!({})), call(name, arguments)],
            |args: &[String]| match args[0].as_str() {
                "idle-time" => idle_for(30),
                _ => desk(&mut ran)(args),
            },
        );
        assert_eq!(replies[1]["result"]["isError"], false, "{name}");
        assert!(!ran.is_empty(), "{name}");
    }
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
    serve(
        Cursor::new("{not json\n"),
        &mut output,
        never_run,
        |_| panic!("nothing was called"),
        LET_GO_AFTER,
    )
    .unwrap();
    let reply: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(reply["id"], Value::Null);
    assert_eq!(reply["error"]["code"], -32700);
}

#[test]
fn arguments_that_are_not_an_object_are_a_tool_error() {
    let replies = served(&[call("list_windows", json!("all"))], never_run);
    assert_eq!(replies[0]["result"]["isError"], true);
}

/// The DevTools methods the engine sends for `domicile devtools`, as
/// `kDevToolsMethods` in the engine's `command_protocol.h` lists them.
const AGENTS_METHODS: [&str; 18] = [
    "Accessibility.getFullAXTree",
    "Accessibility.getPartialAXTree",
    "Accessibility.queryAXTree",
    "DOM.focus",
    "DOM.getBoxModel",
    "DOM.getContentQuads",
    "DOM.scrollIntoViewIfNeeded",
    "Domicile.chooseFiles",
    "Domicile.fileChooser",
    "Input.dispatchKeyEvent",
    "Input.dispatchMouseEvent",
    "Input.insertText",
    "Page.captureScreenshot",
    "Page.getLayoutMetrics",
    "Page.getNavigationHistory",
    "Page.navigate",
    "Page.navigateToHistoryEntry",
    "Page.reload",
];

/// `domicile devtools` arguments without the agent session, which every input
/// method names and no other does: the page it drives copies to that agent's
/// own clipboard.
fn for_the_agent(args: &[String]) -> Vec<String> {
    match args {
        [devtools, flag, session, rest @ ..] if devtools == "devtools" && flag == "--agent" => {
            assert_eq!(session, "7", "sent for the agent's own session");
            assert!(
                rest.iter().any(|arg| arg.starts_with("Input.")),
                "only input names the agent: {args:?}"
            );
            std::iter::once(devtools.clone())
                .chain(rest.iter().cloned())
                .collect()
        }
        [devtools, ..] if devtools == "devtools" => {
            assert!(
                !args.iter().any(|arg| arg.starts_with("Input.")),
                "input names the agent: {args:?}"
            );
            args.to_vec()
        }
        _ => args.to_vec(),
    }
}

/// Stands in for `domicile devtools` on browser window `w1`: answers each
/// method from `answers` and records every run in `ran`.
fn page<'a>(
    answers: &'a [(&'a str, Value)],
    ran: &'a mut Vec<(String, Value)>,
) -> impl FnMut(&[String]) -> io::Result<Ran> + 'a {
    move |args| {
        if args == ["list-windows", "--json"] {
            return printed("[{\"id\": \"w1\", \"views\": []}]\n");
        }
        if args[0] == "focus-window" {
            ran.push((args.join(" "), json!({})));
            return printed("");
        }
        let args = for_the_agent(args);
        assert_eq!(args[..2], ["devtools", "w1"]);
        let params: Value = serde_json::from_str(&args[3]).unwrap();
        ran.push((args[2].clone(), params));
        if !AGENTS_METHODS.contains(&args[2].as_str()) {
            return refused(&format!("\"{}\" is not a method agents get", args[2]));
        }
        let answer = answers
            .iter()
            .find(|(method, _)| *method == args[2])
            .map_or(json!({}), |(_, answer)| answer.clone());
        printed(&format!("{answer}\n"))
    }
}

/// A reply's text parts, a line each.
fn texts(reply: &Value) -> String {
    reply["result"]["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|part| part["text"].as_str())
        .map(|text| format!("{text}\n"))
        .collect()
}

/// DOM.getContentQuads's answer for an element at 10,20 to 110,40.
fn quads() -> (&'static str, Value) {
    (
        "DOM.getContentQuads",
        json!({"quads": [[10, 20, 110, 20, 110, 40, 10, 40]]}),
    )
}

#[test]
fn a_batch_runs_its_steps_in_order_and_reads_the_window_once_at_the_end() {
    let mut ran = Vec::new();
    let replies = served(
        &[call(
            "batch",
            json!({"steps": [
                {"tool": "browser_click", "arguments": {"window": "w1", "ref": "12"}},
                {"tool": "browser_type", "arguments": {"window": "w1", "text": "hi"}},
                {"tool": "browser_key", "arguments": {"window": "w1", "key": "Enter"}},
            ]}),
        )],
        page(&[quads()], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], false, "{replies:?}");
    let methods: Vec<&str> = ran.iter().map(|(method, _)| method.as_str()).collect();
    assert_eq!(
        methods
            .iter()
            .filter(|method| **method == "Accessibility.getFullAXTree")
            .count(),
        1,
        "{methods:?}"
    );
    assert_eq!(methods.last(), Some(&"Accessibility.getFullAXTree"));
    assert!(methods.contains(&"Input.insertText"));
    let text = texts(&replies[0]);
    assert!(
        text.starts_with("1. clicked element 12\n2. typed\n3. pressed Enter\nIn w1: "),
        "{text}"
    );
}

#[test]
fn a_batch_that_opens_a_file_chooser_says_the_page_waits_on_it() {
    let mut ran = Vec::new();
    let chooser =
        json!({"chooser": {"mode": "open", "accept": [], "suggestedName": "", "folder": ""}});
    let replies = served(
        &[call(
            "batch",
            json!({"steps": [
                {"tool": "browser_type", "arguments": {"window": "w1", "text": "hi"}},
                {"tool": "browser_key", "arguments": {"window": "w1", "key": "Enter"}},
            ]}),
        )],
        page(&[("Domicile.fileChooser", chooser)], &mut ran),
    );
    let text = texts(&replies[0]);
    assert!(
        text.contains(
            "In w1: The page waits on a file chooser for a file: answer it with browser_choose_files."
        ),
        "{text}"
    );
}

#[test]
fn a_batch_stops_at_the_first_step_that_fails() {
    let mut ran = Vec::new();
    let replies = served(
        &[call(
            "batch",
            json!({"steps": [
                {"tool": "browser_click", "arguments": {"window": "w1", "ref": "12"}},
                {"tool": "browser_type", "arguments": {"window": "w1"}},
                {"tool": "browser_key", "arguments": {"window": "w1", "key": "Enter"}},
            ]}),
        )],
        page(&[quads()], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    let text = texts(&replies[0]);
    assert!(text.contains("1. clicked element 12"), "{text}");
    assert!(text.contains("2. browser_type takes text"), "{text}");
    assert!(text.contains("Step 3 did not run"), "{text}");
    assert!(!ran.iter().any(|(_, params)| params["type"] == "keyDown"));
    // What the click changed is still read.
    assert_eq!(ran.last().unwrap().0, "Accessibility.getFullAXTree");
}

#[test]
fn a_batch_reads_a_native_window_once_and_says_which_steps_did_not_run() {
    let mut ran: Vec<Vec<String>> = Vec::new();
    let replies = served(
        &[call(
            "batch",
            json!({"steps": [
                {"tool": "app_click", "arguments": {"window": "n1", "ref": ":1.7/w/1"}},
                {"tool": "app_focus", "arguments": {"window": "n1", "ref": ":1.7/w/2"}},
                {"tool": "app_click", "arguments": {"window": "n1"}},
                {"tool": "app_click", "arguments": {"window": "n1", "ref": ":1.7/w/3"}},
                {"tool": "app_click", "arguments": {"window": "n1", "ref": ":1.7/w/4"}},
            ]}),
        )],
        |args| {
            ran.push(args.to_vec());
            printed("- button \"OK\"\n")
        },
    );
    let reads = ran.iter().filter(|args| args[0] == "accessibility").count();
    assert_eq!(reads, 1, "{ran:?}");
    let text = texts(&replies[0]);
    assert!(text.contains("Steps 4 to 5 did not run."), "{text}");
    assert!(text.contains("In n1: "), "{text}");
}

#[test]
fn a_batch_reads_nothing_again_once_the_user_stops_it() {
    let stopped = Rc::new(Cell::new(false));
    let stopping = Rc::clone(&stopped);
    let mut ran = Vec::new();
    let answers = [quads()];
    let mut acting = page(&answers, &mut ran);
    let replies = served_letting(
        &[call(
            "batch",
            json!({"steps": [
                {"tool": "browser_click", "arguments": {"window": "w1", "ref": "12"}},
                {"tool": "browser_key", "arguments": {"window": "w1", "key": "Enter"}},
            ]}),
        )],
        |args| {
            // The user presses Stop as the agent clicks.
            stopping.set(true);
            acting(args)
        },
        |_| {
            let stopped = Rc::clone(&stopped);
            Ok(Grant {
                session: 7,
                reach: Box::new(|| AgentReach::Desk),
                stopped: Box::new(move || stopped.get()),
                did: Box::new(|_| {}),
            })
        },
    );
    drop(acting);
    assert_eq!(replies[0]["result"]["isError"], true);
    assert!(!ran
        .iter()
        .any(|(method, _)| method == "Accessibility.getFullAXTree"));
}

#[test]
fn a_batch_takes_one_to_twenty_steps() {
    let step = json!({"tool": "status", "arguments": {}});
    for steps in [json!(null), json!([]), json!(vec![step; 21])] {
        let replies = served(&[call("batch", json!({"steps": steps}))], never_run);
        assert_eq!(replies[0]["result"]["isError"], true, "{steps}");
    }
}

#[test]
fn a_batch_holds_no_batch_and_neither_asks_nor_lets_go() {
    for tool in ["batch", "ask_to_use_desktop", "stop_using_desktop", "nope"] {
        let replies = served(
            &[call(
                "batch",
                json!({"steps": [{"tool": tool, "arguments": {}}]}),
            )],
            never_run,
        );
        assert_eq!(replies[0]["result"]["isError"], true, "{tool}");
    }
}

#[test]
fn a_browser_snapshot_is_the_pages_accessibility_tree_with_refs() {
    let tree = json!({"nodes": [
        {"nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"}, "name": {"value": "Inbox"}, "childIds": ["2", "3"], "backendDOMNodeId": 1},
        {"nodeId": "2", "ignored": true, "role": {"value": "none"}, "childIds": ["4"], "backendDOMNodeId": 5},
        {"nodeId": "4", "ignored": false, "role": {"value": "button"}, "name": {"value": "Compose"}, "childIds": ["6"], "backendDOMNodeId": 12},
        {"nodeId": "6", "ignored": false, "role": {"value": "StaticText"}, "name": {"value": "Compose"}, "childIds": [], "backendDOMNodeId": 13},
        {"nodeId": "3", "ignored": false, "role": {"value": "generic"}, "childIds": ["7"], "backendDOMNodeId": 20},
        {"nodeId": "7", "ignored": false, "role": {"value": "textbox"}, "name": {"value": "Search"}, "value": {"value": "from:ana"},
         "properties": [{"name": "focused", "value": {"value": true}}], "childIds": [], "backendDOMNodeId": 21}
    ]});
    let mut ran = Vec::new();
    let replies = served(
        &[call("browser_snapshot", json!({"window": "w1"}))],
        page(&[("Accessibility.getFullAXTree", tree)], &mut ran),
    );
    assert_eq!(
        ran,
        [("Accessibility.getFullAXTree".to_string(), json!({}))]
    );
    assert_eq!(replies[0]["result"]["isError"], false);
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "- RootWebArea \"Inbox\" [ref=1]\n  \
         - button \"Compose\" [ref=12]\n  \
         - textbox \"Search\" [ref=21] value=\"from:ana\" focused\n"
    );
}

#[test]
fn a_browser_click_scrolls_the_element_into_view_and_clicks_its_middle() {
    let mut ran = Vec::new();
    let replies = served(
        &[call("browser_click", json!({"window": "w1", "ref": 12}))],
        page(
            &[(
                "DOM.getContentQuads",
                json!({"quads": [[10, 20, 110, 20, 110, 40, 10, 40]]}),
            )],
            &mut ran,
        ),
    );
    assert_eq!(replies[0]["result"]["isError"], false);
    let mouse = |kind: &str| {
        (
            "Input.dispatchMouseEvent".to_string(),
            json!({"type": kind, "x": 60.0, "y": 30.0, "button": "left", "clickCount": 1}),
        )
    };
    assert_eq!(
        ran,
        [
            (
                "DOM.scrollIntoViewIfNeeded".to_string(),
                json!({"backendNodeId": 12})
            ),
            (
                "DOM.getContentQuads".to_string(),
                json!({"backendNodeId": 12})
            ),
            mouse("mouseMoved"),
            mouse("mousePressed"),
            mouse("mouseReleased"),
            // Read again, to answer what it changed.
            ("Domicile.fileChooser".to_string(), json!({})),
            ("Accessibility.getFullAXTree".to_string(), json!({})),
            // The agent's keyboard goes where it clicked, as a hand's does.
            ("focus-window --agent 7 w1".to_string(), json!({})),
        ]
    );
}

#[test]
fn a_browser_click_says_when_the_agents_keyboard_cant_follow_it() {
    let mut ran = Vec::new();
    let answers = [quads()];
    let mut clicked = page(&answers, &mut ran);
    let replies = served(
        &[call("browser_click", json!({"window": "w1", "ref": 12}))],
        |args: &[String]| {
            if args[0] == "focus-window" {
                return refused("the user is typing in w1");
            }
            clicked(args)
        },
    );
    assert_eq!(replies[0]["result"]["isError"], false);
    assert!(
        texts(&replies[0]).contains(
            "Your keyboard is not in it, so key and type_text can't type there: the user is typing in w1"
        ),
        "{replies:?}"
    );
}

/// Page.getLayoutMetrics's answer for a page at device pixel ratio 2, so a
/// screenshot's pixels are half the page's.
fn at_two_x() -> (&'static str, Value) {
    (
        "Page.getLayoutMetrics",
        json!({
            "layoutViewport": {"pageX": 0, "pageY": 0, "clientWidth": 2561, "clientHeight": 1440},
            "cssLayoutViewport": {"pageX": 0, "pageY": 0, "clientWidth": 1280, "clientHeight": 720},
            // Blink floors the CSS layout viewport, but keeps the visual one
            // unrounded, so only its ratio is the scale.
            "visualViewport": {"offsetX": 0, "offsetY": 0, "pageX": 0, "pageY": 0, "clientWidth": 2561.0, "clientHeight": 1440.0, "scale": 1, "zoom": 1},
            "cssVisualViewport": {"offsetX": 0, "offsetY": 0, "pageX": 0, "pageY": 0, "clientWidth": 1280.5, "clientHeight": 720.0, "scale": 1, "zoom": 1}
        }),
    )
}

#[test]
fn a_browser_click_at_a_point_clicks_there_in_the_pages_pixels() {
    let mut ran = Vec::new();
    let replies = served(
        &[call(
            "browser_click",
            json!({"window": "w1", "at": [200, 100], "button": "right"}),
        )],
        page(&[at_two_x()], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], false, "{replies:?}");
    assert_eq!(
        ran[..4],
        [
            ("Page.getLayoutMetrics".to_string(), json!({})),
            (
                "Input.dispatchMouseEvent".to_string(),
                json!({"type": "mouseMoved", "x": 100.0, "y": 50.0})
            ),
            (
                "Input.dispatchMouseEvent".to_string(),
                json!({"type": "mousePressed", "x": 100.0, "y": 50.0, "button": "right", "buttons": 2, "clickCount": 1})
            ),
            (
                "Input.dispatchMouseEvent".to_string(),
                json!({"type": "mouseReleased", "x": 100.0, "y": 50.0, "button": "right", "buttons": 0, "clickCount": 1})
            ),
        ]
    );
}

#[test]
fn a_browser_double_click_counts_its_clicks() {
    let mut ran = Vec::new();
    served(
        &[call(
            "browser_click",
            json!({"window": "w1", "at": [2, 2], "count": 2}),
        )],
        page(&[at_two_x()], &mut ran),
    );
    let presses: Vec<&Value> = ran
        .iter()
        .filter(|(_, params)| params["type"] == "mousePressed")
        .map(|(_, params)| &params["clickCount"])
        .collect();
    assert_eq!(presses, [&json!(1), &json!(2)]);
}

#[test]
fn a_browser_click_takes_a_ref_or_a_point() {
    let replies = served(
        &[call("browser_click", json!({"window": "w1"}))],
        page(&[], &mut Vec::new()),
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    let replies = served(
        &[call(
            "browser_click",
            json!({"window": "w1", "at": [1, 1], "count": 3}),
        )],
        page(&[at_two_x()], &mut Vec::new()),
    );
    assert_eq!(replies[0]["result"]["isError"], true);
}

#[test]
fn a_browser_drag_presses_moves_in_steps_and_lets_go() {
    let mut ran = Vec::new();
    let replies = served(
        &[call(
            "browser_drag",
            json!({"window": "w1", "from": [0, 0], "to": [160, 80]}),
        )],
        page(&[at_two_x()], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], false, "{replies:?}");
    let mouse: Vec<&Value> = ran
        .iter()
        .filter(|(method, _)| method == "Input.dispatchMouseEvent")
        .map(|(_, params)| params)
        .collect();
    assert_eq!(mouse[1]["type"], "mousePressed");
    assert_eq!(mouse[1]["buttons"], 1);
    let last = mouse.len() - 1;
    // The last move is at the end, with the button still held.
    assert_eq!(mouse[last - 1]["type"], "mouseMoved");
    assert_eq!(
        (mouse[last - 1]["x"].as_f64(), mouse[last - 1]["y"].as_f64()),
        (Some(80.0), Some(40.0))
    );
    assert_eq!(mouse[last - 1]["buttons"], 1);
    assert_eq!(mouse[last]["type"], "mouseReleased");
    assert_eq!(mouse.len(), 3 + 8);
}

#[test]
fn a_browser_scroll_turns_the_wheel_at_a_point() {
    let mut ran = Vec::new();
    let replies = served(
        &[call(
            "browser_scroll",
            json!({"window": "w1", "at": [100, 100], "by": [0, 240]}),
        )],
        page(&[at_two_x()], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], false, "{replies:?}");
    assert_eq!(
        ran[1],
        (
            "Input.dispatchMouseEvent".to_string(),
            json!({"type": "mouseWheel", "x": 50.0, "y": 50.0, "deltaX": 0.0, "deltaY": 120.0})
        )
    );
}

#[test]
fn a_browser_click_on_an_element_with_no_box_says_so() {
    let mut ran = Vec::new();
    let replies = served(
        &[call("browser_click", json!({"window": "w1", "ref": 12}))],
        page(&[("DOM.getContentQuads", json!({"quads": []}))], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    assert!(replies[0]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("12"));
}

#[test]
fn browser_type_focuses_the_element_then_inserts_the_text() {
    let mut ran = Vec::new();
    served(
        &[
            call(
                "browser_type",
                json!({"window": "w1", "ref": 21, "text": "hi"}),
            ),
            call("browser_type", json!({"window": "w1", "text": "there"})),
        ],
        page(&[], &mut ran),
    );
    assert_eq!(
        ran,
        [
            ("DOM.focus".to_string(), json!({"backendNodeId": 21})),
            ("Input.insertText".to_string(), json!({"text": "hi"})),
            ("Accessibility.getFullAXTree".to_string(), json!({})),
            ("Input.insertText".to_string(), json!({"text": "there"})),
            ("Accessibility.getFullAXTree".to_string(), json!({})),
        ]
    );
}

#[test]
fn browser_key_presses_and_releases_a_named_key() {
    let mut ran = Vec::new();
    served(
        &[call("browser_key", json!({"window": "w1", "key": "Enter"}))],
        page(&[], &mut ran),
    );
    assert_eq!(
        ran,
        [
            (
                "Input.dispatchKeyEvent".to_string(),
                json!({"type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "text": "\r"})
            ),
            (
                "Input.dispatchKeyEvent".to_string(),
                json!({"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
            ),
            ("Domicile.fileChooser".to_string(), json!({})),
            ("Accessibility.getFullAXTree".to_string(), json!({})),
        ]
    );
    let replies = served(
        &[call(
            "browser_key",
            json!({"window": "w1", "key": "Hyperdrive"}),
        )],
        never_run,
    );
    assert_eq!(replies[0]["result"]["isError"], true);
}

#[test]
fn a_press_that_opens_a_file_chooser_says_the_page_waits_on_it() {
    let mut ran = Vec::new();
    let chooser = json!({"chooser": {"mode": "open-multiple", "accept": ["mp4", "mov"], "suggestedName": "", "folder": ""}});
    let replies = served(
        &[call("browser_key", json!({"window": "w1", "key": "Enter"}))],
        page(&[("Domicile.fileChooser", chooser)], &mut ran),
    );
    let said = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        said.contains(
            "The page waits on a file chooser for one or more files, accepting .mp4, .mov: \
             answer it with browser_choose_files."
        ),
        "{said}"
    );
}

#[test]
fn browser_choose_files_answers_the_chooser_with_paths_or_cancels_it() {
    let mut ran = Vec::new();
    let replies = served(
        &[
            call(
                "browser_choose_files",
                json!({"window": "w1", "paths": ["/home/me/clip.mp4"]}),
            ),
            call(
                "browser_choose_files",
                json!({"window": "w1", "cancel": true}),
            ),
        ],
        page(&[], &mut ran),
    );
    assert_eq!(replies[0]["result"]["isError"], false);
    assert_eq!(replies[1]["result"]["isError"], false);
    let sent: Vec<_> = ran
        .iter()
        .filter(|(method, _)| method == "Domicile.chooseFiles")
        .map(|(_, params)| params.clone())
        .collect();
    assert_eq!(
        sent,
        [
            json!({"files": ["/home/me/clip.mp4"]}),
            json!({"cancel": true})
        ]
    );
}

#[test]
fn browser_choose_files_takes_absolute_paths_or_a_cancel() {
    for arguments in [
        json!({"window": "w1"}),
        json!({"window": "w1", "paths": ["clip.mp4"]}),
        json!({"window": "w1", "paths": ["/a"], "cancel": true}),
        json!({"window": "w1", "paths": "/a"}),
    ] {
        let replies = served(
            &[call("browser_choose_files", arguments.clone())],
            never_run,
        );
        assert_eq!(replies[0]["result"]["isError"], true, "{arguments}");
    }
}

#[test]
fn browser_navigate_goes_to_the_address() {
    let mut ran = Vec::new();
    served(
        &[call(
            "browser_navigate",
            json!({"window": "w1", "url": "https://example.com/"}),
        )],
        page(&[], &mut ran),
    );
    assert_eq!(
        ran,
        [
            (
                "Page.navigate".to_string(),
                json!({"url": "https://example.com/"})
            ),
            ("Accessibility.getFullAXTree".to_string(), json!({})),
        ]
    );
}

#[test]
fn a_browser_screenshot_is_a_small_webp_of_the_page() {
    let mut ran = Vec::new();
    let replies = served(
        &[call("browser_screenshot", json!({"window": "w1"}))],
        page(
            &[("Page.captureScreenshot", json!({"data": "UklGRg=="}))],
            &mut ran,
        ),
    );
    assert_eq!(
        ran,
        [(
            "Page.captureScreenshot".to_string(),
            json!({"format": "webp", "quality": 70})
        )]
    );
    assert_eq!(
        replies[0]["result"]["content"][0],
        json!({"type": "image", "data": "UklGRg==", "mimeType": "image/webp"})
    );
}

/// Stands in for `domicile` on Claude's window `w1`, whose page is empty and
/// whose chat is view `9` at 200,40: answers each method from `answers` and
/// records every run in `ran` with the view it went to. Anything else, such
/// as giving the window the agent's keyboard after a click in a view, fails.
fn electron_window<'a>(
    answers: &'a [(&'a str, Value)],
    ran: &'a mut Vec<(Option<String>, String, Value)>,
) -> impl FnMut(&[String]) -> io::Result<Ran> + 'a {
    move |args| {
        if args == ["list-windows", "--json"] {
            return printed(
                "[{\"id\": \"w1\", \"views\": [{\"id\": \"9\", \"position\": [200, 40], \"size\": [600, 560]}]}]\n",
            );
        }
        let args = for_the_agent(args);
        let (view, args) = match args.as_slice() {
            [devtools, flag, view, rest @ ..] if devtools == "devtools" && flag == "--view" => {
                (Some(view.clone()), rest)
            }
            [devtools, rest @ ..] if devtools == "devtools" => (None, rest),
            _ => panic!("ran domicile {args:?}"),
        };
        assert_eq!(args[0], "w1");
        let params: Value = serde_json::from_str(&args[2]).unwrap();
        ran.push((view.clone(), args[1].clone(), params));
        let answer = answers
            .iter()
            .find(|(method, _)| *method == args[1] && view.is_some())
            .map_or(json!({"nodes": []}), |(_, answer)| answer.clone());
        printed(&format!("{answer}\n"))
    }
}

#[test]
fn a_browser_snapshot_reads_each_view_the_window_holds_with_its_refs() {
    let chat = json!({"nodes": [
        {"nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"}, "name": {"value": "Claude"}, "childIds": ["2"], "backendDOMNodeId": 1},
        {"nodeId": "2", "ignored": false, "role": {"value": "checkbox"}, "name": {"value": "Claude Code can use your desktop"},
         "properties": [{"name": "checked", "value": {"value": "true"}}], "childIds": [], "backendDOMNodeId": 12}
    ]});
    let mut ran = Vec::new();
    let replies = served(
        &[call("browser_snapshot", json!({"window": "w1"}))],
        electron_window(&[("Accessibility.getFullAXTree", chat)], &mut ran),
    );
    assert_eq!(
        ran,
        [
            (None, "Accessibility.getFullAXTree".to_string(), json!({})),
            (
                Some("9".to_string()),
                "Accessibility.getFullAXTree".to_string(),
                json!({})
            ),
        ]
    );
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "- view 9, at 200,40, 600x560\n  \
         - RootWebArea \"Claude\" [ref=9:1]\n    \
         - checkbox \"Claude Code can use your desktop\" [ref=9:12] checked=\"true\"\n"
    );
}

#[test]
fn browser_tools_act_in_the_view_a_ref_names_or_the_view_given() {
    let mut ran = Vec::new();
    let replies = served(
        &[
            call("browser_click", json!({"window": "w1", "ref": "9:12"})),
            call(
                "browser_key",
                json!({"window": "w1", "view": "9", "key": "Tab"}),
            ),
            call("browser_screenshot", json!({"window": "w1", "view": "9"})),
        ],
        electron_window(
            &[
                (
                    "DOM.getContentQuads",
                    json!({"quads": [[10, 20, 110, 20, 110, 40, 10, 40]]}),
                ),
                ("Page.captureScreenshot", json!({"data": "UklGRg=="})),
            ],
            &mut ran,
        ),
    );
    assert!(
        replies
            .iter()
            .all(|reply| reply["result"]["isError"] == false),
        "{replies:?}"
    );
    // Reading the window again, after each act, reads all of it.
    assert!(
        ran.iter()
            .filter(|(_, method, _)| method != "Accessibility.getFullAXTree")
            .all(|(view, _, _)| view.as_deref() == Some("9")),
        "{ran:?}"
    );
    assert_eq!(ran[1].2, json!({"backendNodeId": 12}));
}

#[test]
fn a_ref_from_one_view_is_refused_in_another() {
    let replies = served(
        &[call(
            "browser_type",
            json!({"window": "w1", "view": "7", "ref": "9:12", "text": "hi"}),
        )],
        never_run,
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "ref 9:12 is in view 9, not view 7"
    );
}

#[test]
fn a_browser_tool_passes_on_why_devtools_refused() {
    let replies = served(&[call("browser_snapshot", json!({"window": "w9"}))], |_| {
        Ok(Ran {
            success: false,
            stdout: String::new(),
            stderr: "domicile: window w9 is private, and agents do not drive private windows\n"
                .to_string(),
        })
    });
    assert_eq!(replies[0]["result"]["isError"], true);
    assert!(replies[0]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("private"));
}

#[test]
fn app_tools_read_and_act_on_a_native_windows_accessibility_tree() {
    assert_eq!(
        ran_for("app_snapshot", json!({"window": "kD3m"})),
        ["accessibility", "kD3m"]
    );
    assert_eq!(
        ran_for("app_click", json!({"window": "kD3m", "ref": ":1.7/w/1"})),
        ["accessibility-act", "kD3m", ":1.7/w/1", "click"]
    );
    assert_eq!(
        ran_for("app_focus", json!({"window": "kD3m", "ref": ":1.7/w/1"})),
        ["accessibility-act", "kD3m", ":1.7/w/1", "focus"]
    );
    assert_eq!(
        ran_for(
            "app_set_text",
            json!({"window": "kD3m", "ref": ":1.7/w/1", "text": "hi"})
        ),
        ["accessibility-act", "kD3m", ":1.7/w/1", "set-text", "hi"]
    );
    let replies = served(&[call("app_click", json!({"window": "kD3m"}))], never_run);
    assert_eq!(replies[0]["result"]["isError"], true);
}

/// A grant of `reach`, and what it was told the agent did. Never stopped.
fn reaching(reach: AgentReach) -> (Grant, Rc<RefCell<Vec<String>>>) {
    let did = Rc::new(RefCell::new(Vec::new()));
    let told = Rc::clone(&did);
    (
        Grant {
            session: 7,
            reach: Box::new(move || reach.clone()),
            stopped: Box::new(|| false),
            did: Box::new(move |said| told.borrow_mut().push(said.to_string())),
        },
        did,
    )
}

fn shared(id: &str, kind: WindowKind, title: &str) -> AgentWindow {
    AgentWindow {
        id: id.into(),
        kind,
        title: title.into(),
        app: None,
    }
}

/// Only the browser window `w1` ("Pull requests") and the native window
/// `n1` ("Notes").
fn two_windows() -> AgentReach {
    AgentReach::Windows {
        windows: vec![
            shared("w1", WindowKind::Browser, "Pull requests"),
            shared("n1", WindowKind::Native, "Notes"),
        ],
    }
}

#[test]
fn the_first_tool_call_asks_the_user_once_in_the_clients_name() {
    let asked = Rc::new(RefCell::new(Vec::new()));
    let asking = Rc::clone(&asked);
    served_letting(
        &[
            json!({
                "jsonrpc": "2.0",
                "id": 0,
                "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "clientInfo": {"name": "claude-code", "title": "Claude Code"}}
            }),
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            call("status", json!({})),
            call("status", json!({})),
        ],
        |_| printed("{}"),
        move |name| {
            asking.borrow_mut().push(name.to_string());
            Ok(reaching(AgentReach::Desk).0)
        },
    );
    assert_eq!(*asked.borrow(), ["Claude Code"]);
}

#[test]
fn an_agent_the_user_did_not_let_in_is_refused_every_call_without_asking_again() {
    let asked = Cell::new(0);
    let replies = served_letting(
        &[call("status", json!({})), call("status", json!({}))],
        never_run,
        |_| {
            asked.set(asked.get() + 1);
            Err("the user did not let it in".to_string())
        },
    );
    assert_eq!(asked.get(), 1);
    for reply in &replies {
        assert_eq!(reply["result"]["isError"], true);
        let text = reply["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("did not let An agent use this desktop"),
            "{text}"
        );
    }
}

#[test]
fn an_agent_the_user_stopped_is_refused() {
    let replies = served_letting(&[call("status", json!({}))], never_run, |_| {
        Ok(Grant {
            session: 7,
            reach: Box::new(|| AgentReach::Desk),
            stopped: Box::new(|| true),
            did: Box::new(|_| ()),
        })
    });
    let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("stopped"), "{text}");
}

#[test]
fn a_stopped_agent_asks_again_only_through_ask_to_use_desktop() {
    let asked = Rc::new(Cell::new(0));
    let asking = Rc::clone(&asked);
    let replies = served_letting(
        &[
            call("status", json!({})),
            call("status", json!({})),
            call("ask_to_use_desktop", json!({})),
            call("status", json!({})),
            call("ask_to_use_desktop", json!({})),
        ],
        |_| printed("{}"),
        move |_| {
            asking.set(asking.get() + 1);
            // The first grant the user stops at once; the second holds.
            let stopped = asking.get() == 1;
            Ok(Grant {
                session: 7,
                reach: Box::new(|| AgentReach::Desk),
                stopped: Box::new(move || stopped),
                did: Box::new(|_| ()),
            })
        },
    );
    let text = |reply: &Value| {
        reply["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string()
    };
    for reply in &replies[..2] {
        assert_eq!(reply["result"]["isError"], true);
        assert!(
            text(reply).contains("call ask_to_use_desktop"),
            "{}",
            text(reply)
        );
    }
    assert_eq!(replies[2]["result"]["isError"], false);
    assert!(
        text(&replies[2]).contains("let An agent use"),
        "{}",
        text(&replies[2])
    );
    assert_eq!(replies[3]["result"]["isError"], false);
    assert!(
        text(&replies[4]).contains("already"),
        "{}",
        text(&replies[4])
    );
    assert_eq!(asked.get(), 2, "it asks once more, when asked to");
}

#[test]
fn an_agent_turned_away_can_ask_again() {
    let asked = Cell::new(0);
    let replies = served_letting(
        &[
            call("status", json!({})),
            call("ask_to_use_desktop", json!({})),
            call("status", json!({})),
        ],
        |_| printed("{}"),
        |_| {
            asked.set(asked.get() + 1);
            if asked.get() == 1 {
                Err("the user did not let it in".to_string())
            } else {
                Ok(reaching(AgentReach::Desk).0)
            }
        },
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    assert_eq!(replies[1]["result"]["isError"], false);
    assert_eq!(replies[2]["result"]["isError"], false);
    assert_eq!(asked.get(), 2);
}

/// Sets its flag when dropped, as a grant's `domicile agent` ends.
struct Ends(Rc<Cell<bool>>);

impl Drop for Ends {
    fn drop(&mut self) {
        self.0.set(true);
    }
}

#[test]
fn stop_using_desktop_lets_go_of_the_grant_and_the_next_call_asks_again() {
    let ended = Rc::new(Cell::new(false));
    let asked = Rc::new(Cell::new(0));
    let (ending, asking) = (Rc::clone(&ended), Rc::clone(&asked));
    let replies = served_letting(
        &[
            call("status", json!({})),
            call("stop_using_desktop", json!({})),
            call("status", json!({})),
        ],
        |_| printed("{}"),
        move |_| {
            asking.set(asking.get() + 1);
            if asking.get() == 2 {
                assert!(ending.get(), "the first grant ends before it asks again");
            }
            let ends = Ends(Rc::clone(&ending));
            Ok(Grant {
                session: 7,
                reach: Box::new(|| AgentReach::Desk),
                stopped: Box::new(|| false),
                did: Box::new(move |_| {
                    let _ = &ends;
                }),
            })
        },
    );
    assert_eq!(replies[1]["result"]["isError"], false);
    let text = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("no longer uses"), "{text}");
    assert_eq!(replies[2]["result"]["isError"], false);
    assert_eq!(asked.get(), 2);
}

/// Sets its flag when dropped, from any thread.
struct EndsShared(Arc<AtomicBool>);

impl Drop for EndsShared {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[test]
fn an_agent_that_calls_nothing_for_a_while_lets_go_and_its_next_call_asks_again() {
    let ended = Arc::new(AtomicBool::new(false));
    let asked = Rc::new(Cell::new(0));
    let (ending, asking) = (Arc::clone(&ended), Rc::clone(&asked));
    let (input, mut calls) = io::pipe().unwrap();
    let waiting = thread::spawn(move || {
        writeln!(calls, "{}", call("screenshot", json!({}))).unwrap();
        while !ended.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
        // Its points are still in the screenshot's pixels.
        writeln!(calls, "{}", call("click", json!({"x": 1, "y": 1}))).unwrap();
    });
    let mut ran = Vec::new();
    let mut output = Vec::new();
    serve(
        BufReader::new(input),
        &mut output,
        desk(&mut ran),
        move |_| {
            asking.set(asking.get() + 1);
            let ends = EndsShared(Arc::clone(&ending));
            Ok(Grant {
                session: 7,
                reach: Box::new(|| AgentReach::Desk),
                stopped: Box::new(|| false),
                did: Box::new(move |_| {
                    let _ = &ends;
                }),
            })
        },
        Duration::from_millis(50),
    )
    .unwrap();
    waiting.join().unwrap();
    assert_eq!(asked.get(), 2);
    let replies: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies[1]["result"]["isError"], false, "{replies:?}");
}

#[test]
fn an_agent_the_user_stopped_is_still_told_so_after_a_while() {
    let stopped = Rc::new(Cell::new(false));
    let stopping = Rc::clone(&stopped);
    let (input, mut calls) = io::pipe().unwrap();
    let pausing = thread::spawn(move || {
        writeln!(calls, "{}", call("status", json!({}))).unwrap();
        thread::sleep(Duration::from_millis(500));
        writeln!(calls, "{}", call("status", json!({}))).unwrap();
    });
    let mut asked = 0;
    let mut output = Vec::new();
    serve(
        BufReader::new(input),
        &mut output,
        |_| {
            stopped.set(true);
            printed("{}")
        },
        |_| {
            asked += 1;
            let stopped = Rc::clone(&stopping);
            Ok(Grant {
                session: 7,
                reach: Box::new(|| AgentReach::Desk),
                stopped: Box::new(move || stopped.get()),
                did: Box::new(|_| {}),
            })
        },
        Duration::from_millis(50),
    )
    .unwrap();
    pausing.join().unwrap();
    assert_eq!(asked, 1);
    let last: Value =
        serde_json::from_slice(output.split(|byte| *byte == b'\n').nth(1).unwrap()).unwrap();
    let text = last["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("stopped"), "{text}");
}

#[test]
fn stop_using_desktop_before_any_use_asks_nothing() {
    let replies = served_letting(&[call("stop_using_desktop", json!({}))], never_run, |_| {
        panic!("asked the user")
    });
    assert_eq!(replies[0]["result"]["isError"], false);
    let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("was not using"), "{text}");
}

#[test]
fn what_an_agent_did_is_listed_with_the_windows_title_and_never_what_it_typed() {
    let (grant, did) = reaching(two_windows());
    let mut grant = Some(grant);
    served_letting(
        &[
            call(
                "app_set_text",
                json!({"window": "n1", "ref": ":1.7/w/1/text", "text": "hunter2"}),
            ),
            call("browser_snapshot", json!({"window": "w1"})),
        ],
        |args| match args[0].as_str() {
            "devtools" => printed("{\"nodes\": []}"),
            "list-windows" => printed("[{\"id\": \"w1\", \"views\": []}]"),
            _ => printed(""),
        },
        move |_| Ok(grant.take().expect("asked once")),
    );
    assert_eq!(*did.borrow(), ["Typed in Notes", "Read Pull requests"]);
}

#[test]
fn what_an_agent_did_in_a_browser_window_names_the_page_it_shows_now() {
    // The title list_windows gave is the page before; a browser act reads the
    // page again, so the activity names the page the window shows.
    let (grant, did) = reaching(AgentReach::Desk);
    let mut grant = Some(grant);
    let new_page = json!({"nodes": [
        {"nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"}, "name": {"value": "Wayland"}, "childIds": [], "backendDOMNodeId": 1}
    ]});
    served_letting(
        &[
            call("list_windows", json!({})),
            call(
                "browser_navigate",
                json!({"window": "w1", "url": "https://example.com/"}),
            ),
            call("browser_key", json!({"window": "w1", "key": "Tab"})),
        ],
        move |args| match args[0].as_str() {
            "list-windows" => printed("[{\"id\": \"w1\", \"title\": \"Sway\", \"views\": []}]"),
            "devtools" if args[2] == "Accessibility.getFullAXTree" => {
                printed(&format!("{new_page}\n"))
            }
            _ => printed("{}"),
        },
        move |_| Ok(grant.take().expect("asked once")),
    );
    assert_eq!(
        *did.borrow(),
        [
            "Listed the windows",
            "Loaded a page in Wayland",
            "Pressed a key in Wayland"
        ]
    );
}

#[test]
fn with_only_some_windows_the_desk_wide_tools_are_refused() {
    for (name, arguments) in [
        ("screenshot", json!({})),
        ("click", json!({"x": 1, "y": 1})),
        ("type_text", json!({"text": "hi"})),
        ("key", json!({"chord": "ctrl+l"})),
        ("send_shell", json!({"words": ["focus", "left"]})),
        ("exec", json!({"argv": ["kitty"]})),
        ("open", json!({"target": "https://example.com"})),
        ("focus_window", json!({"id": "n1"})),
        ("status", json!({})),
    ] {
        let replies = served_letting(&[call(name, arguments)], never_run, |_| {
            Ok(reaching(two_windows()).0)
        });
        let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("only some windows"), "{name}: {text}");
    }
}

#[test]
fn with_only_some_windows_a_window_not_shared_is_refused() {
    for (name, arguments) in [
        ("browser_snapshot", json!({"window": "w2"})),
        ("app_snapshot", json!({"window": "n2"})),
        ("close_window", json!({"id": "n2"})),
    ] {
        let replies = served_letting(&[call(name, arguments)], never_run, |_| {
            Ok(reaching(two_windows()).0)
        });
        let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("did not share window"), "{name}: {text}");
    }
}

#[test]
fn with_only_some_windows_list_windows_lists_only_those() {
    let replies = served_letting(
        &[call("list_windows", json!({}))],
        |_| {
            printed(
                r#"[{"id": "n1", "title": "Notes"}, {"id": "n2", "title": "Secrets"}, {"id": "w1", "title": "Pull requests"}]"#,
            )
        },
        |_| Ok(reaching(two_windows()).0),
    );
    let listed: Value =
        serde_json::from_str(replies[0]["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        listed,
        json!([{"id": "n1", "title": "Notes"}, {"id": "w1", "title": "Pull requests"}])
    );
}

#[test]
fn a_change_the_user_makes_applies_from_the_next_call() {
    let reach = Rc::new(RefCell::new(AgentReach::Desk));
    let changing = Rc::clone(&reach);
    let mut grant = Some(Grant {
        session: 7,
        reach: Box::new(move || changing.borrow().clone()),
        stopped: Box::new(|| false),
        did: Box::new(|_| ()),
    });
    let narrowed = Rc::clone(&reach);
    let replies = served_letting(
        &[call("status", json!({})), call("status", json!({}))],
        move |_| {
            // After the first call runs, the user narrows it to two windows,
            // which takes the desk-wide `status` away.
            *narrowed.borrow_mut() = two_windows();
            printed("{}")
        },
        move |_| Ok(grant.take().expect("asked once")),
    );
    assert_eq!(replies[0]["result"]["isError"], false);
    assert_eq!(replies[1]["result"]["isError"], true);
}

/// An accessibility tree of one button named `named`, ref 12, on page "Inbox".
fn one_button(named: &str) -> Value {
    json!({"nodes": [
        {"nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"}, "name": {"value": "Inbox"}, "childIds": ["2"], "backendDOMNodeId": 1},
        {"nodeId": "2", "ignored": false, "role": {"value": "button"}, "name": {"value": named}, "childIds": [], "backendDOMNodeId": 12}
    ]})
}

/// Stands in for `domicile devtools` on browser window `w1`, whose tree is
/// each of `trees` in turn, the last one from then on.
fn changing_page(trees: Vec<Value>) -> impl FnMut(&[String]) -> io::Result<Ran> {
    let mut read = 0;
    move |args| {
        if args == ["list-windows", "--json"] {
            return printed("[{\"id\": \"w1\", \"views\": []}]\n");
        }
        let answer = match args[2].as_str() {
            "Accessibility.getFullAXTree" => {
                read += 1;
                trees[(read - 1).min(trees.len() - 1)].clone()
            }
            "DOM.getContentQuads" => json!({"quads": [[10, 20, 110, 20, 110, 40, 10, 40]]}),
            _ => json!({}),
        };
        printed(&format!("{answer}\n"))
    }
}

#[test]
fn a_browser_act_answers_what_changed_since_the_window_was_last_read() {
    let replies = served(
        &[
            call("browser_snapshot", json!({"window": "w1"})),
            call("browser_click", json!({"window": "w1", "ref": 12})),
            call("browser_key", json!({"window": "w1", "key": "Tab"})),
        ],
        changing_page(vec![one_button("Send"), one_button("Sent")]),
    );
    assert_eq!(
        replies[1]["result"]["content"][0]["text"],
        "clicked element 12\n\
         What changed in the window since it was last read:\n\
         gone: button \"Send\" [ref=12]\n\
         new: button \"Sent\" [ref=12]\n"
    );
    assert_eq!(
        replies[2]["result"]["content"][0]["text"],
        "pressed Tab\nNothing in the window changed.\n"
    );
}

/// A page of `count` buttons, as `one_button`'s.
fn buttons(count: u64) -> Value {
    let mut nodes = vec![json!({
        "nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"},
        "name": {"value": "Inbox"},
        "childIds": (0..count).map(|index| format!("b{index}")).collect::<Vec<_>>(),
        "backendDOMNodeId": 1,
    })];
    nodes.extend((0..count).map(|index| {
        json!({"nodeId": format!("b{index}"), "ignored": false, "role": {"value": "button"},
               "name": {"value": "b"}, "childIds": [], "backendDOMNodeId": 100 + index})
    }));
    json!({ "nodes": nodes })
}

#[test]
fn a_browser_snapshot_leaves_out_the_text_boxes_that_repeat_their_text() {
    let tree = json!({"nodes": [
        {"nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"}, "name": {"value": "Inbox"}, "childIds": ["2"], "backendDOMNodeId": 1},
        {"nodeId": "2", "ignored": false, "role": {"value": "StaticText"}, "name": {"value": "Hello world"}, "childIds": ["3", "4"], "backendDOMNodeId": 2},
        {"nodeId": "3", "ignored": false, "role": {"value": "InlineTextBox"}, "name": {"value": "Hello "}, "childIds": []},
        {"nodeId": "4", "ignored": false, "role": {"value": "InlineTextBox"}, "name": {"value": "world"}, "childIds": []}
    ]});
    let replies = served(
        &[call("browser_snapshot", json!({"window": "w1"}))],
        page(&[("Accessibility.getFullAXTree", tree)], &mut Vec::new()),
    );
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "- RootWebArea \"Inbox\" [ref=1]\n  \
         - StaticText \"Hello world\" [ref=2]\n"
    );
}

#[test]
fn a_browser_snapshot_of_a_huge_page_is_cut_and_says_so() {
    let replies = served(
        &[call("browser_snapshot", json!({"window": "w1"}))],
        changing_page(vec![buttons(MOST as u64 + 10)]),
    );
    let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert_eq!(text.lines().count(), MOST + 1);
    assert!(
        text.ends_with(&format!("… cut at {MOST} elements\n")),
        "{text}"
    );
}

#[test]
fn a_browser_act_on_a_huge_window_not_read_yet_answers_its_top_and_says_so() {
    let replies = served(
        &[call("browser_key", json!({"window": "w1", "key": "Enter"}))],
        changing_page(vec![buttons(1000)]),
    );
    let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        text.starts_with("pressed Enter\nThe window now:\n- RootWebArea \"Inbox\" [ref=1]\n"),
        "{text}"
    );
    assert!(text.lines().count() < 300, "{} lines", text.lines().count());
    assert!(
        text.ends_with("browser_snapshot reads all of it.\n"),
        "{text}"
    );
}

#[test]
fn a_browser_act_that_changes_a_huge_part_of_a_window_answers_some_and_says_so() {
    let replies = served(
        &[
            call("browser_snapshot", json!({"window": "w1"})),
            call("browser_key", json!({"window": "w1", "key": "End"})),
        ],
        changing_page(vec![one_button("Search"), buttons(1000)]),
    );
    let text = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        text.starts_with("pressed End\nWhat changed in the window since it was last read:\n"),
        "{text}"
    );
    assert!(text.lines().count() < 300, "{} lines", text.lines().count());
    assert!(
        text.ends_with("browser_snapshot reads all of it.\n"),
        "{text}"
    );
}

#[test]
fn a_browser_act_on_a_window_not_read_yet_answers_all_of_it() {
    let replies = served(
        &[call("browser_type", json!({"window": "w1", "text": "hi"}))],
        changing_page(vec![one_button("Send")]),
    );
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "typed\nThe window now:\n\
         - RootWebArea \"Inbox\" [ref=1]\n  \
         - button \"Send\" [ref=12]\n"
    );
}

#[test]
fn an_app_act_answers_what_changed_since_the_window_was_last_read() {
    let mut reads = 0;
    let replies = served(
        &[
            call("app_snapshot", json!({"window": "kD3m"})),
            call("app_click", json!({"window": "kD3m", "ref": ":1.7/w/1"})),
        ],
        move |args| match args[0].as_str() {
            "accessibility" => {
                reads += 1;
                printed(match reads {
                    1 => "- frame \"Notes\" [ref=:1.7/w/0]\n  - push button \"Save\" [ref=:1.7/w/1]\n",
                    _ => "- frame \"Notes\" [ref=:1.7/w/0]\n  - push button \"Saved\" [ref=:1.7/w/1]\n",
                })
            }
            _ => printed(""),
        },
    );
    assert_eq!(
        replies[1]["result"]["content"][0]["text"],
        "What changed in the window since it was last read:\n\
         gone: push button \"Save\" [ref=:1.7/w/1]\n\
         new: push button \"Saved\" [ref=:1.7/w/1]\n"
    );
}

#[test]
fn an_act_whose_window_cannot_be_read_again_says_so_and_that_it_acted() {
    let refused = |stderr: &str| {
        Ok(Ran {
            success: false,
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    };
    let replies = served(
        &[
            call("browser_key", json!({"window": "w1", "key": "Tab"})),
            call("app_focus", json!({"window": "kD3m", "ref": ":1.7/w/1"})),
        ],
        |args| match (args[0].as_str(), args.get(2).map(String::as_str)) {
            ("devtools", Some("Accessibility.getFullAXTree")) | ("accessibility", _) => {
                refused("domicile: the window closed\n")
            }
            _ => printed("{}\n"),
        },
    );
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "pressed Tab\nIt could not be read again: domicile: the window closed\n"
    );
    assert_eq!(
        replies[1]["result"]["content"][0]["text"],
        "{}\nIt could not be read again: domicile: the window closed\n"
    );
    assert!(replies
        .iter()
        .all(|reply| reply["result"]["isError"] == false));
}

#[test]
fn the_browser_tools_read_the_shells_own_page_as_window_shell() {
    let mut ran = Vec::new();
    let replies = served(
        &[call("browser_snapshot", json!({"window": "shell"}))],
        |args: &[String]| {
            ran.push(args.to_vec());
            printed(&format!("{}\n", one_button("Wi-Fi")))
        },
    );
    // The shell holds no views, and list-windows doesn't list it.
    assert_eq!(
        ran,
        [["devtools", "shell", "Accessibility.getFullAXTree", "{}"]]
    );
    assert_eq!(
        replies[0]["result"]["content"][0]["text"],
        "- RootWebArea \"Inbox\" [ref=1]\n  - button \"Wi-Fi\" [ref=12]\n"
    );
}

#[test]
fn an_agent_given_only_some_windows_cannot_reach_the_shell() {
    let replies = served_letting(
        &[call("browser_snapshot", json!({"window": "shell"}))],
        never_run,
        |_| Ok(reaching(two_windows()).0),
    );
    assert_eq!(replies[0]["result"]["isError"], true);
}
