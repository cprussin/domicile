//! `domicile mcp`: a Model Context Protocol server over stdio, so an agent
//! such as Claude Code can drive the running desktop.
//!
//! Each tool runs one `domicile` verb and answers what it printed. Reading the
//! desktop goes through the CLI, so a tool and its verb cannot disagree. See
//! `docs/CLI.md#domicile-mcp`.

use std::io::{self, BufRead, Write};

use serde_json::{json, Map, Value};

/// The protocol versions this server speaks, newest first.
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// JSON-RPC error codes.
const PARSE_ERROR: i64 = -32700;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

/// What a run of `domicile` printed, and whether it succeeded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ran {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Answers each JSON-RPC message on `input`, one per line, on `output`, until
/// `input` ends. `domicile` runs the `domicile` binary with the arguments it
/// is given.
pub fn serve(
    input: impl BufRead,
    mut output: impl Write,
    mut domicile: impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => answer(&message, &mut domicile)?,
            Err(why) => Some(error(&Value::Null, PARSE_ERROR, &why.to_string())),
        };
        if let Some(reply) = reply {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}

/// The reply to `message`, or `None` for a notification.
fn answer(
    message: &Value,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<Option<Value>> {
    let Some(id) = message.get("id") else {
        return Ok(None);
    };
    let params = &message["params"];
    let reply = match message["method"].as_str() {
        Some("initialize") => result(id, initialized(params)),
        Some("ping") => result(id, json!({})),
        Some("tools/list") => result(id, json!({"tools": listed_tools()})),
        Some("tools/call") => match params["name"].as_str().and_then(tool) {
            Some(tool) => result(id, called(&tool, &params["arguments"], domicile)?),
            None => error(id, INVALID_PARAMS, &format!("no tool {}", params["name"])),
        },
        _ => error(
            id,
            METHOD_NOT_FOUND,
            &format!("no method {}", message["method"]),
        ),
    };
    Ok(Some(reply))
}

/// `initialize`'s result: the client's protocol version when this server
/// speaks it, else the newest this server does.
fn initialized(params: &Value) -> Value {
    let asked = params["protocolVersion"].as_str();
    let version = PROTOCOL_VERSIONS
        .into_iter()
        .find(|version| Some(*version) == asked)
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "domicile", "version": env!("CARGO_PKG_VERSION")},
    })
}

fn result(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn error(id: &Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

/// A tool: the `domicile` verb it runs.
#[derive(Debug, Clone, Copy)]
enum Tool {
    /// A verb whose `--json` listing is the answer.
    Listing(&'static str),
    SendShell,
    Open,
    /// A verb that takes a `list-windows` id.
    WindowAct(&'static str),
    Theme,
    Screenshot,
}

/// Each tool, by name, in the order `tools/list` gives them.
const TOOLS: [(&str, Tool); 12] = [
    ("list_windows", Tool::Listing("list-windows")),
    ("list_displays", Tool::Listing("list-displays")),
    ("list_inputs", Tool::Listing("list-inputs")),
    ("status", Tool::Listing("status")),
    ("list_shell_commands", Tool::Listing("list-shell-commands")),
    ("list_bindings", Tool::Listing("list-bindings")),
    ("send_shell", Tool::SendShell),
    ("open", Tool::Open),
    ("focus_window", Tool::WindowAct("focus-window")),
    ("close_window", Tool::WindowAct("close-window")),
    ("theme", Tool::Theme),
    ("screenshot", Tool::Screenshot),
];

fn tool(name: &str) -> Option<Tool> {
    TOOLS
        .into_iter()
        .find(|(named, _)| *named == name)
        .map(|(_, tool)| tool)
}

fn listed_tools() -> Vec<Value> {
    TOOLS
        .into_iter()
        .map(|(name, tool)| {
            let (description, properties, required) = described(tool);
            json!({
                "name": name,
                "description": description,
                "inputSchema": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            })
        })
        .collect()
}

/// A tool's description, its arguments' JSON schemas and which are required.
fn described(tool: Tool) -> (&'static str, Value, Vec<&'static str>) {
    let window_id =
        json!({"id": {"type": "string", "description": "The window's id, from list_windows."}});
    match tool {
        Tool::Listing("list-windows") => (
            "List the windows, native and browser, as JSON: id, kind, title, app, pid, size, focused, url, private.",
            json!({}),
            vec![],
        ),
        Tool::Listing("list-displays") => (
            "List the displays as JSON: name, mode, scale, position, and whether each is on.",
            json!({}),
            vec![],
        ),
        Tool::Listing("list-inputs") => (
            "List the keyboards, pointers and touch devices as JSON.",
            json!({}),
            vec![],
        ),
        Tool::Listing("status") => (
            "The desktop's state as JSON: shell, theme, keymap, lock, screens, and what keeps them on or captures the desktop.",
            json!({}),
            vec![],
        ),
        Tool::Listing("list-shell-commands") => (
            "List the commands send_shell takes, as the shell describes them, as JSON.",
            json!({}),
            vec![],
        ),
        Tool::Listing(_) => (
            "List the shell's keys and gestures in each binding mode and what they run, as JSON.",
            json!({}),
            vec![],
        ),
        Tool::SendShell => (
            "Run a shell command, as a keybinding does, and answer what it printed. list_shell_commands lists them.",
            json!({"words": {"type": "array", "items": {"type": "string"}, "description": "The command and its arguments, such as [\"focus\", \"left\"]."}}),
            vec!["words"],
        ),
        Tool::Open => (
            "Open a file, folder or URL with its default app; a URL opens in a browser window.",
            json!({
                "target": {"type": "string", "description": "An absolute path or a URL."},
                "app": {"type": "boolean", "description": "Open a site as an app, with no address bar."},
                "profile": {"type": "string", "description": "The browser profile a URL opens in."},
            }),
            vec!["target"],
        ),
        Tool::WindowAct("focus-window") => (
            "Show and focus a window.",
            window_id,
            vec!["id"],
        ),
        Tool::WindowAct(_) => ("Ask a window to close.", window_id, vec!["id"]),
        Tool::Theme => (
            "Set the theme to light or dark, or toggle it. With no change, answer the current theme.",
            json!({"change": {"type": "string", "enum": ["light", "dark", "toggle"]}}),
            vec![],
        ),
        Tool::Screenshot => (
            "Take a PNG of every monitor.",
            json!({}),
            vec![],
        ),
    }
}

/// `tools/call`'s result for `tool` with `arguments`.
fn called(
    tool: &Tool,
    arguments: &Value,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<Value> {
    // A call with no arguments may leave them out.
    let none = Map::new();
    let arguments = match arguments {
        Value::Null => &none,
        Value::Object(arguments) => arguments,
        other => return Ok(said(false, format!("arguments are an object, not {other}"))),
    };
    let args = match command(tool, arguments) {
        Ok(args) => args,
        Err(why) => return Ok(said(false, why)),
    };
    match tool {
        Tool::Screenshot => screenshot(args, domicile),
        _ => {
            let ran = domicile(&args)?;
            Ok(if ran.success {
                said(true, ran.stdout)
            } else {
                said(false, ran.stderr)
            })
        }
    }
}

/// The arguments `domicile` runs with for `tool`, or why `arguments` don't
/// make a command.
fn command(tool: &Tool, arguments: &Map<String, Value>) -> Result<Vec<String>, String> {
    match tool {
        Tool::Listing(verb) => Ok(vec![verb.to_string(), "--json".to_string()]),
        Tool::SendShell => {
            let words = arguments
                .get("words")
                .and_then(Value::as_array)
                .ok_or("send_shell takes words, an array of strings")?;
            let words = words
                .iter()
                .map(|word| word.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .ok_or("send_shell's words are strings")?;
            Ok([vec!["send-shell".to_string()], words].concat())
        }
        Tool::Open => {
            let target = string(arguments, "target")?.ok_or("open takes a target")?;
            let app = match arguments.get("app") {
                None => false,
                Some(app) => app.as_bool().ok_or("open's app is true or false")?,
            };
            let profile = string(arguments, "profile")?;
            Ok([
                vec!["open".to_string()],
                app.then(|| "--app".to_string()).into_iter().collect(),
                profile
                    .map(|profile| vec!["--profile".to_string(), profile])
                    .unwrap_or_default(),
                vec![target],
            ]
            .concat())
        }
        Tool::WindowAct(verb) => {
            let id = string(arguments, "id")?.ok_or("this tool takes a window id")?;
            Ok(vec![verb.to_string(), id])
        }
        Tool::Theme => Ok([
            vec!["theme".to_string()],
            string(arguments, "change")?.into_iter().collect(),
        ]
        .concat()),
        Tool::Screenshot => Ok(vec!["screenshot".to_string()]),
    }
}

/// Argument `name`, if given, or why it is not a string.
fn string(arguments: &Map<String, Value>, name: &str) -> Result<Option<String>, String> {
    match arguments.get(name) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(other) => Err(format!("{name} is a string, and was given {other}")),
    }
}

/// Runs `domicile screenshot` into a temporary file and answers the PNG.
fn screenshot(
    args: Vec<String>,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<Value> {
    let directory = tempfile::tempdir()?;
    let file = directory.path().join("screenshot.png");
    let ran = domicile(&[args, vec![file.to_string_lossy().into_owned()]].concat())?;
    if ran.success {
        let png = std::fs::read(&file)?;
        Ok(json!({
            "content": [{"type": "image", "data": base64(&png), "mimeType": "image/png"}],
            "isError": false,
        }))
    } else {
        Ok(said(false, ran.stderr))
    }
}

/// A tool result of text.
fn said(success: bool, text: String) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": !success})
}

/// Standard base64, with padding.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    bytes
        .chunks(3)
        .flat_map(|chunk| {
            let word = chunk.iter().enumerate().fold(0u32, |word, (at, byte)| {
                word | u32::from(*byte) << (16 - 8 * at)
            });
            (0..4).map(move |at| {
                if at <= chunk.len() {
                    char::from(ALPHABET[(word >> (18 - 6 * at) & 63) as usize])
                } else {
                    '='
                }
            })
        })
        .collect()
}
