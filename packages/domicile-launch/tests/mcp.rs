//! Tests for `domicile mcp`: the Model Context Protocol server over stdio.

use std::cell::{Cell, RefCell};
use std::io;
use std::rc::Rc;

use domicile_launch::mcp::{serve, Grant, Ran};
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
    serve(input.as_bytes(), &mut output, domicile, admit).unwrap();
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
            "browser_snapshot",
            "browser_click",
            "browser_type",
            "browser_key",
            "browser_navigate",
            "browser_screenshot",
            "app_snapshot",
            "app_click",
            "app_focus",
            "app_set_text",
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
    serve("{not json\n".as_bytes(), &mut output, never_run, |_| {
        panic!("nothing was called")
    })
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

/// Stands in for `domicile devtools` on browser window `w1`: answers each
/// method from `answers` and records every run in `ran`.
fn page<'a>(
    answers: &'a [(&'a str, Value)],
    ran: &'a mut Vec<(String, Value)>,
) -> impl FnMut(&[String]) -> io::Result<Ran> + 'a {
    move |args| {
        assert_eq!(args[..2], ["devtools", "w1"]);
        let params: Value = serde_json::from_str(&args[3]).unwrap();
        ran.push((args[2].clone(), params));
        let answer = answers
            .iter()
            .find(|(method, _)| *method == args[2])
            .map_or(json!({}), |(_, answer)| answer.clone());
        printed(&format!("{answer}\n"))
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
        ]
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
            ("Input.insertText".to_string(), json!({"text": "there"})),
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
        [(
            "Page.navigate".to_string(),
            json!({"url": "https://example.com/"})
        )]
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
            reach,
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
            reach: AgentReach::Desk,
            stopped: Box::new(|| true),
            did: Box::new(|_| ()),
        })
    });
    let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("stopped"), "{text}");
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
            _ => printed(""),
        },
        move |_| Ok(grant.take().expect("asked once")),
    );
    assert_eq!(*did.borrow(), ["Typed in Notes", "Read Pull requests"]);
}

#[test]
fn with_only_some_windows_the_desk_wide_tools_are_refused() {
    for (name, arguments) in [
        ("screenshot", json!({})),
        ("click", json!({"x": 1, "y": 1})),
        ("type_text", json!({"text": "hi"})),
        ("key", json!({"chord": "ctrl+l"})),
        ("send_shell", json!({"words": ["focus", "left"]})),
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
