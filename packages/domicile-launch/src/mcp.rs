//! `domicile mcp`: a Model Context Protocol server over stdio, so an agent
//! such as Claude Code can drive the running desktop.
//!
//! Each tool runs one `domicile` verb and answers what it printed. Reading the
//! desktop goes through the CLI, so a tool and its verb cannot disagree. See
//! `docs/CLI.md#domicile-mcp`.
//!
//! The first tool call asks the user to let the agent in, through `domicile
//! agent`: the whole desk, or only some windows. Every call after is checked
//! against what they allowed, and listed in the shell as what the agent did.
//! See `docs/AGENTS.md`.

mod acme;
mod browser;
mod changes;
mod http;
mod oauth;
pub mod web;

use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use browser::Browser;
pub use http::{serve_http, Web, IDLE_MS};
pub use oauth::{sign_out, signed_in, Answer, Asks, Said, SignedIn, ASK_MS, SIGNED_IN_FILE};

use domicile_protocol::{AgentReach, DeskShot};
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

/// What the user let an agent do, from `domicile agent`.
pub struct Grant {
    /// Its session, whose own seat its pointer and keys go to.
    pub session: u32,
    /// What the user lets it reach now; they may change it.
    pub reach: Box<dyn Fn() -> AgentReach>,
    /// Whether the user has stopped it since.
    pub stopped: Box<dyn Fn() -> bool>,
    /// Lists what it did, in the shell.
    pub did: Box<dyn FnMut(&str)>,
}

/// What an agent calls itself when its client gives no name.
const UNNAMED: &str = "An agent";

/// The agent this server serves, and what the user let it do.
struct Session {
    /// As its client names itself in `initialize`.
    name: String,
    /// `None` until its first tool call asks the user; then the grant, or
    /// why there is none.
    grant: Option<Result<Grant, String>>,
    /// Each window's title, as last listed, to say where the agent acted.
    titles: HashMap<String, String>,
    /// The last screenshot, whose pixels the pointer tools take.
    view: Option<View>,
    /// Each window's outline, by id, as the agent last read it, to answer
    /// an act with what it changed.
    read: HashMap<String, String>,
}

/// Runs the `domicile` binary with the arguments it is given.
type Runs<'a> = dyn FnMut(&[String]) -> io::Result<Ran> + 'a;

/// Asks the user to let the agent it names in.
type Admits<'a> = dyn FnMut(&str) -> Result<Grant, String> + 'a;

/// One agent's conversation with this server: what it is called, what the
/// user let it do, and the `domicile` it drives. Each transport keeps one per
/// session.
pub struct Agent<'a> {
    session: Session,
    domicile: Box<Runs<'a>>,
    admit: Box<Admits<'a>>,
}

impl<'a> Agent<'a> {
    /// `domicile` runs the `domicile` binary with the arguments it is given.
    /// `admit` asks the user to let the agent it names in, and holds it in
    /// until this is dropped.
    pub fn new(
        domicile: impl FnMut(&[String]) -> io::Result<Ran> + 'a,
        admit: impl FnMut(&str) -> Result<Grant, String> + 'a,
    ) -> Agent<'a> {
        Agent {
            session: Session {
                name: UNNAMED.to_string(),
                grant: None,
                titles: HashMap::new(),
                view: None,
                read: HashMap::new(),
            },
            domicile: Box::new(domicile),
            admit: Box::new(admit),
        }
    }

    /// The reply to one JSON-RPC message, or `None` for a notification.
    pub fn answer(&mut self, message: &Value) -> io::Result<Option<Value>> {
        answer(
            message,
            &mut self.domicile,
            &mut self.admit,
            &mut self.session,
        )
    }

    /// Lets go of the desk after the agent called nothing for a while, ending
    /// its `domicile agent` and its place in the bar. It keeps what it read
    /// and its last screenshot, since its next call may still use them. A
    /// grant the user stopped stays, so the next call says so rather than
    /// asking again.
    fn let_go_idle(&mut self) {
        if let Some(Ok(grant)) = &self.session.grant {
            if !(grant.stopped)() {
                self.session.grant = None;
            }
        }
    }

    /// The reply to one line of JSON-RPC, which may not parse.
    pub fn answer_line(&mut self, line: &str) -> io::Result<Option<Value>> {
        match serde_json::from_str::<Value>(line) {
            Ok(message) => self.answer(&message),
            Err(why) => Ok(Some(error(&Value::Null, PARSE_ERROR, &why.to_string()))),
        }
    }
}

/// How long an agent may go without a message before it lets go of the desk,
/// as `stop_using_desktop` does. Its next tool call asks again.
pub const LET_GO_AFTER: Duration = Duration::from_secs(2 * 60);

/// Answers each JSON-RPC message on `input`, one per line, on `output`, until
/// `input` ends, as one [`Agent`], which lets go of the desk whenever no
/// message comes for `let_go_after`.
pub fn serve(
    input: impl BufRead + Send + 'static,
    mut output: impl Write,
    domicile: impl FnMut(&[String]) -> io::Result<Ran>,
    admit: impl FnMut(&str) -> Result<Grant, String>,
    let_go_after: Duration,
) -> io::Result<()> {
    let (lines, read) = mpsc::channel();
    // Read on a thread of its own, so the agent can let go while it waits.
    thread::spawn(move || {
        for line in input.lines() {
            if lines.send(line).is_err() {
                return;
            }
        }
    });
    let mut agent = Agent::new(domicile, admit);
    answered_until_idle(&read, let_go_after, &mut agent, |agent, line| {
        let line = line?;
        if line.trim().is_empty() {
            return Ok(());
        }
        if let Some(reply) = agent.answer_line(&line)? {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
        Ok(())
    })
}

/// Hands `agent` each of `asked` to `answer`, until `asked` ends, letting go
/// of the desk whenever none comes for `let_go_after`.
fn answered_until_idle<T>(
    asked: &Receiver<T>,
    let_go_after: Duration,
    agent: &mut Agent<'_>,
    mut answer: impl FnMut(&mut Agent<'_>, T) -> io::Result<()>,
) -> io::Result<()> {
    loop {
        match asked.recv_timeout(let_go_after) {
            Ok(message) => answer(agent, message)?,
            Err(RecvTimeoutError::Timeout) => agent.let_go_idle(),
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

/// The reply to `message`, or `None` for a notification.
fn answer(
    message: &Value,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    admit: &mut impl FnMut(&str) -> Result<Grant, String>,
    session: &mut Session,
) -> io::Result<Option<Value>> {
    let Some(id) = message.get("id") else {
        return Ok(None);
    };
    let params = &message["params"];
    let reply = match message["method"].as_str() {
        Some("initialize") => {
            session.name = named(params);
            result(id, initialized(params))
        }
        Some("ping") => result(id, json!({})),
        Some("tools/list") => result(id, json!({"tools": listed_tools()})),
        Some("tools/call") => match params["name"].as_str().and_then(tool) {
            Some(tool) => result(
                id,
                guarded(tool, &params["arguments"], domicile, admit, session, false)?,
            ),
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
        "instructions": INSTRUCTIONS,
    })
}

/// How an agent should use the tools, sent in `initialize`. Reading a window
/// as text takes fewer steps and tokens than looking at the desk.
const INSTRUCTIONS: &str = "Read and act on windows as text first: list_windows, then \
    browser_snapshot or app_snapshot, then the browser_ and app_ tools by ref. The \
    browser_ tools reach the shell's own bars, panels and dialogs as window \"shell\". \
    Each act answers what it changed in the window, so there is no need to look again. \
    Each call costs a round trip, so when you know several steps ahead, such as click a \
    field, type, then press Enter, run them in one batch. \
    Use screenshot only for what a tree can't show: images, layout, or an app that \
    doesn't support accessibility. Zoom into an area rather than taking the whole desk \
    again. The user may be using the desktop as you work. click, key, type_text and the \
    other pointer tools use your own pointer and keyboard, which never move theirs, in \
    native and browser windows alike, so they reach a canvas or anything else a tree \
    can't. They are refused in a window the user is in, and over the shell, which you \
    act on by ref. A tool that acts on a window acts on the one your own keyboard is in \
    when you name none, never the user's: send_shell too, to move a window of yours to \
    another workspace say. Call stop_using_desktop as soon as you are done with \
    the desktop. Before you wait on anything else, such as an approval, a background \
    job or the user, call stop_using_desktop too: asking again later is quick, and a \
    remembered agent is not asked at all. An agent that calls nothing for two minutes \
    is let go.";

/// What the client calls itself in `initialize`: its title, else its name.
fn named(params: &Value) -> String {
    let client = &params["clientInfo"];
    [&client["title"], &client["name"]]
        .into_iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map_or_else(|| UNNAMED.to_string(), str::to_string)
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
    Exec,
    Open,
    /// A verb that takes a `list-windows` id.
    WindowAct(&'static str),
    Theme,
    Screenshot,
    Click,
    MovePointer,
    Drag,
    Scroll,
    Key,
    TypeText,
    /// A browser window driven through `domicile devtools`.
    Browser(Browser),
    /// `accessibility`: a native window's tree.
    AppSnapshot,
    /// `accessibility-act` with this act, which takes no text but `set-text`.
    AppAct(&'static str),
    /// Asks the user again, after they stopped the agent or turned it away.
    AskToUse,
    /// Lets go of the desktop, ending the agent's grant.
    StopUsing,
    /// Runs other tools in order, reading the windows they act on once.
    Batch,
}

/// Where the last screenshot's top-left corner is on the desk, and how many
/// pixels of the desk each of its pixels is, across and down.
#[derive(Debug, Clone, Copy)]
struct View {
    left: f64,
    top: f64,
    across: f64,
    down: f64,
}

/// The longest side of a screenshot, in pixels. Models see larger images
/// shrunk, which would move every point they read off one.
const FIT: u32 = 1280;

/// Each tool, by name, in the order `tools/list` gives them.
const TOOLS: [(&str, Tool); 35] = [
    ("list_windows", Tool::Listing("list-windows")),
    ("list_displays", Tool::Listing("list-displays")),
    ("list_inputs", Tool::Listing("list-inputs")),
    ("status", Tool::Listing("status")),
    ("list_shell_commands", Tool::Listing("list-shell-commands")),
    ("list_bindings", Tool::Listing("list-bindings")),
    ("send_shell", Tool::SendShell),
    ("exec", Tool::Exec),
    ("open", Tool::Open),
    ("focus_window", Tool::WindowAct("focus-window")),
    ("close_window", Tool::WindowAct("close-window")),
    ("theme", Tool::Theme),
    ("screenshot", Tool::Screenshot),
    ("click", Tool::Click),
    ("move_pointer", Tool::MovePointer),
    ("drag", Tool::Drag),
    ("scroll", Tool::Scroll),
    ("key", Tool::Key),
    ("type_text", Tool::TypeText),
    ("browser_snapshot", Tool::Browser(Browser::Snapshot)),
    ("browser_click", Tool::Browser(Browser::Click)),
    ("browser_drag", Tool::Browser(Browser::Drag)),
    ("browser_scroll", Tool::Browser(Browser::Scroll)),
    ("browser_type", Tool::Browser(Browser::Type)),
    ("browser_key", Tool::Browser(Browser::Key)),
    ("browser_navigate", Tool::Browser(Browser::Navigate)),
    ("browser_screenshot", Tool::Browser(Browser::Screenshot)),
    ("browser_choose_files", Tool::Browser(Browser::ChooseFiles)),
    ("app_snapshot", Tool::AppSnapshot),
    ("app_click", Tool::AppAct("click")),
    ("app_focus", Tool::AppAct("focus")),
    ("app_set_text", Tool::AppAct("set-text")),
    ("ask_to_use_desktop", Tool::AskToUse),
    ("stop_using_desktop", Tool::StopUsing),
    ("batch", Tool::Batch),
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
    let yours = json!({"type": "string", "description": "A window's id, from list_windows. Left out, the window your keyboard is in."});
    let coordinate = json!({"type": "number", "description": "In the last screenshot's pixels."});
    let point = json!({"type": "array", "items": coordinate, "minItems": 2, "maxItems": 2});
    let native = json!({"type": "string", "description": "A native window's id, from list_windows. Left out, the window your keyboard is in."});
    let app_element =
        json!({"type": "string", "description": "An element's ref, from app_snapshot."});
    match tool {
        Tool::Listing("list-windows") => (
            "List the windows, native and browser, as JSON: id, kind, title, app, pid, size, focused, url, private, held_by (the agent seat whose pointer or keyboard is in it, absent when it is the user's), and the views a browser window holds.",
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
            "Run a shell command, as a keybinding does, on a window of yours, and answer what it printed. list_shell_commands lists them. It acts on the window your keyboard is in, or on the one you name, which it takes with your keyboard first, as focus_window does. Never on the user's focus: refused in a window the user is in, and for a command the shell runs on no window, such as one that changes the user's workspace.",
            json!({
                "words": {"type": "array", "items": {"type": "string"}, "description": "The command and its arguments, such as [\"floating\", \"toggle\"] or [\"move\", \"container\", \"to\", \"workspace\", \"3\"]."},
                "window": yours.clone()
            }),
            vec!["words"],
        ),
        Tool::Exec => (
            "Start a program as the desktop starts apps, without a shell, its name found on the desktop's PATH. Its windows open held by your own pointer and keyboard, with your keyboard in them, and never take the user's. Fails saying why when it does not start.",
            json!({"argv": {"type": "array", "items": {"type": "string"}, "minItems": 1, "description": "The program and its arguments, such as [\"kitty\", \"--hold\", \"btop\"]."}}),
            vec!["argv"],
        ),
        Tool::Open => (
            "Open a file, folder or URL with its default app. What it opens, a file's app or a URL's new browser window, is held by your own pointer and keyboard from the start, and never takes the user's. A site opened as an app is the user's, since it may be their open one.",
            json!({
                "target": {"type": "string", "description": "An absolute path or a URL."},
                "app": {"type": "boolean", "description": "Open a site as an app, with no address bar."},
                "profile": {"type": "string", "description": "The browser profile a URL opens in."},
            }),
            vec!["target"],
        ),
        Tool::WindowAct("focus-window") => (
            "Give a window, native or browser, your own keyboard, for key and type_text. The user's focus stays where it is, and the window is not raised.",
            window_id,
            vec!["id"],
        ),
        Tool::WindowAct(_) => (
            "Ask a window of yours to close: the one your keyboard is in, or the one you name, which it takes with your keyboard first, as focus_window does. Refused in a window the user is in.",
            json!({"window": yours.clone()}),
            vec![],
        ),
        Tool::Theme => (
            "Set the theme to light or dark, or toggle it. With no change, answer the current theme.",
            json!({"change": {"type": "string", "enum": ["light", "dark", "toggle"]}}),
            vec![],
        ),
        Tool::Screenshot => (
            "Take a PNG of every monitor, or of an area of the last screenshot, at most 1280 pixels across. The pointer tools take points in its pixels. Slower and larger than browser_snapshot and app_snapshot: use it only for what they can't show. To read small text, take an area rather than changing windows or the layout.",
            json!({"area": {"type": "array", "items": coordinate, "minItems": 4, "maxItems": 4, "description": "[x, y, width, height] of the last screenshot, to zoom into."}}),
            vec![],
        ),
        Tool::Click => (
            "Click at a point of the last screenshot with your own pointer, which never moves the user's, giving that window your keyboard. Works in native and browser windows the user isn't in, but not on the shell. Where a tree has what you want, browser_click or app_click by ref is surer.",
            json!({
                "x": coordinate,
                "y": coordinate,
                "button": {"type": "string", "enum": ["left", "right", "middle"]},
                "count": {"type": "integer", "enum": [1, 2], "description": "2 double-clicks the left button."},
            }),
            vec!["x", "y"],
        ),
        Tool::MovePointer => (
            "Move your own pointer to a point of the last screenshot, over a native or browser window.",
            json!({"x": coordinate, "y": coordinate}),
            vec!["x", "y"],
        ),
        Tool::Drag => (
            "Press the left button at one point of the last screenshot and release it at another, in or across native and browser windows.",
            json!({"from": point, "to": point}),
            vec!["from", "to"],
        ),
        Tool::Scroll => (
            "Scroll at a point of the last screenshot, by dx and dy of its pixels; positive is right and down.",
            json!({"x": coordinate, "y": coordinate, "dx": coordinate, "dy": coordinate}),
            vec!["x", "y", "dx", "dy"],
        ),
        Tool::Key => (
            "Press a chord of XKB keysym names, such as ctrl+l or Return, with your own keyboard, in the window you name, which it takes with your keyboard first, or the one you last clicked or focused. The shell's own bindings are the user's: use send_shell.",
            json!({"chord": {"type": "string"}, "window": yours.clone()}),
            vec!["chord"],
        ),
        Tool::TypeText => (
            "Type text with your own keyboard, into the window you name, which it takes with your keyboard first, or the one you last clicked or focused. In a window with a tree, browser_type or app_set_text instead.",
            json!({"text": {"type": "string"}, "window": yours}),
            vec!["text"],
        ),
        Tool::Browser(browser) => browser::described(browser),
        Tool::AppSnapshot => (
            "Read a native window's accessibility tree: one element a line, with the ref the other app tools take. Needs an app that supports accessibility; works on hidden windows.",
            json!({"window": native}),
            vec![],
        ),
        Tool::AppAct("click") => (
            "Click an element of a native window by its ref, running its own click or press action. Answers what it changed in the window.",
            json!({"window": native, "ref": app_element}),
            vec!["ref"],
        ),
        Tool::AppAct("focus") => (
            "Give an element of a native window the keyboard focus, by its ref. Answers what it changed in the window.",
            json!({"window": native, "ref": app_element}),
            vec!["ref"],
        ),
        Tool::AppAct(_) => (
            "Replace the text of an editable element of a native window, by its ref. Answers what it changed in the window.",
            json!({"window": native, "ref": app_element, "text": {"type": "string"}}),
            vec!["ref", "text"],
        ),
        Tool::AskToUse => (
            "Ask the user again to let you use the desktop, after they stopped you or turned you away. Only when the user asks you to: it shows them a dialog.",
            json!({}),
            vec![],
        ),
        Tool::StopUsing => (
            "Let go of the desktop once you are done with it, or before you wait on anything else, so the user sees you are gone. Your next tool call asks the user again.",
            json!({}),
            vec![],
        ),
        Tool::Batch => (
            "Run several tools in one call, in order, such as clicking a field, typing into it and pressing Enter. Stops at the first step that fails. Answers each step's result, numbered, then what changed in each window the steps acted on, read once at the end. Use it whenever you know the next steps without seeing what the first ones did.",
            json!({"steps": {
                "type": "array",
                "minItems": 1,
                "maxItems": MOST_STEPS,
                "items": {
                    "type": "object",
                    "properties": {
                        "tool": {"type": "string", "description": "Any tool but batch, ask_to_use_desktop and stop_using_desktop."},
                        "arguments": {"type": "object"},
                    },
                    "required": ["tool"],
                },
            }}),
            vec!["steps"],
        ),
    }
}

/// `tools/call`'s result for `tool` with `arguments`, once the user lets the
/// agent in and only within what they allowed. An act on a window answers
/// what it changed, unless `quiet`.
fn guarded(
    tool: Tool,
    arguments: &Value,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    admit: &mut impl FnMut(&str) -> Result<Grant, String>,
    session: &mut Session,
    quiet: bool,
) -> io::Result<Value> {
    // A call with no arguments may leave them out.
    let none = Map::new();
    let arguments = match arguments {
        Value::Null => &none,
        Value::Object(arguments) => arguments,
        other => return Ok(said(false, format!("arguments are an object, not {other}"))),
    };
    let name = session.name.clone();
    match tool {
        Tool::AskToUse => return Ok(asked_again(admit, session)),
        Tool::StopUsing => return Ok(let_go(session)),
        Tool::Batch => return batched(arguments, domicile, admit, session),
        _ => {}
    }
    let grant = match session.grant.get_or_insert_with(|| admitted(admit, &name)) {
        Ok(grant) => grant,
        Err(why) => return Ok(said(false, why.clone())),
    };
    if (grant.stopped)() {
        return Ok(said(false, stopped(&name)));
    }
    // Read once per call: a change the user makes applies from the next.
    let reach = (grant.reach)();
    let focused;
    let arguments = match your_focus(tool, arguments, grant.session, &reach, domicile)? {
        Ok(None) => arguments,
        Ok(Some(filled)) => {
            focused = filled;
            &focused
        }
        Err(why) => return Ok(said(false, why)),
    };
    if let AgentReach::Windows { windows } = &reach {
        if let Err(why) = within(tool, arguments, windows, &name) {
            return Ok(said(false, why));
        }
        for window in windows {
            session
                .titles
                .entry(window.id.clone())
                .or_insert_with(|| window.title.clone());
        }
    }
    let mut answered = called(
        tool,
        arguments,
        grant.session,
        domicile,
        &mut session.view,
        &mut session.read,
        &mut session.titles,
        quiet,
    )?;
    if answered["isError"] == json!(false) {
        if tool_is_listing_windows(tool) {
            answered = listed_windows(answered, &reach, &mut session.titles);
        }
        (grant.did)(&what_it_did(tool, arguments, &session.titles));
    }
    Ok(answered)
}

/// `arguments` with the window seat `seat`'s keyboard is in, for a tool that
/// reads or drives a window by ref and names none, or `None` when they need
/// no window, or why there is none. An agent the user shared only some
/// windows with has no keyboard, so it names one.
fn your_focus(
    tool: Tool,
    arguments: &Map<String, Value>,
    seat: u32,
    reach: &AgentReach,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<Result<Option<Map<String, Value>>, String>> {
    if !matches!(tool, Tool::Browser(_) | Tool::AppSnapshot | Tool::AppAct(_))
        || arguments.contains_key("window")
    {
        return Ok(Ok(None));
    }
    if let AgentReach::Windows { .. } = reach {
        return Ok(Err(
            "Name the window: the user shared only some windows with you, and list_windows lists them."
                .to_string(),
        ));
    }
    let ran = domicile(&["list-windows".to_string(), "--json".to_string()])?;
    if !ran.success {
        return Ok(Err(ran.stderr));
    }
    let windows: Vec<domicile_protocol::ListedWindow> = serde_json::from_str(&ran.stdout)?;
    Ok(
        crate::control::focused_window(&windows, Some(seat)).map(|window| {
            let mut filled = arguments.clone();
            filled.insert("window".to_string(), Value::String(window.id.clone()));
            Some(filled)
        }),
    )
}

/// The most steps a batch takes.
const MOST_STEPS: usize = 20;

/// `batch`'s result: each step's answer, numbered, up to the first that
/// fails, then what changed in each window its steps acted on, read once
/// after one wait for the windows to settle.
fn batched(
    arguments: &Map<String, Value>,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    admit: &mut impl FnMut(&str) -> Result<Grant, String>,
    session: &mut Session,
) -> io::Result<Value> {
    let steps = match stepped(arguments) {
        Ok(steps) => steps,
        Err(why) => return Ok(said(false, why)),
    };
    let mut content = Vec::new();
    let mut failed = false;
    // Each window a step acted on, in order, whether it is a browser's, and
    // whether a step pressed or keyed in it.
    let mut acted: Vec<(String, bool, bool)> = Vec::new();
    for (number, (tool, arguments)) in steps.iter().enumerate() {
        let answer = guarded(*tool, arguments, domicile, admit, session, true)?;
        // Each step's text numbered, with its images after it.
        for part in answer["content"].as_array().into_iter().flatten() {
            match part["text"].as_str() {
                Some(said) => content.push(
                    json!({"type": "text", "text": format!("{}. {}", number + 1, said.trim_end())}),
                ),
                None => content.push(part.clone()),
            }
        }
        if answer["isError"] != json!(false) {
            failed = true;
            let (next, last) = (number + 2, steps.len());
            match next.cmp(&last) {
                std::cmp::Ordering::Less => content.push(
                    json!({"type": "text", "text": format!("Steps {next} to {last} did not run.")}),
                ),
                std::cmp::Ordering::Equal => content
                    .push(json!({"type": "text", "text": format!("Step {next} did not run.")})),
                std::cmp::Ordering::Greater => {}
            }
            break;
        }
        let (browser, pressed) = match tool {
            Tool::Browser(browser) if browser::acts(*browser) => (true, browser::presses(*browser)),
            Tool::AppAct(_) => (false, false),
            _ => continue,
        };
        if let Some(window) = arguments["window"].as_str() {
            match acted.iter_mut().find(|(seen, _, _)| seen == window) {
                Some((_, _, was)) => *was |= pressed,
                None => acted.push((window.to_string(), browser, pressed)),
            }
        }
    }
    // Read again only what the user still lets the agent reach.
    let reach = match &session.grant {
        Some(Ok(grant)) if !(grant.stopped)() => Some((grant.reach)()),
        _ => None,
    };
    acted.retain(|(window, _, _)| match &reach {
        Some(AgentReach::Desk) => true,
        Some(AgentReach::Windows { windows }) => windows.iter().any(|shared| shared.id == *window),
        None => false,
    });
    if !acted.is_empty() {
        std::thread::sleep(changes::SETTLE);
    }
    for (window, browser, pressed) in acted {
        let note = match pressed {
            true => browser::chooser_note(&window, None, domicile)?,
            false => None,
        };
        let changes = match browser {
            true => browser::read_again(&window, domicile, &mut session.read, &mut session.titles)?,
            false => app_read_again(&window, domicile, &mut session.read)?,
        };
        let changes = match note {
            Some(note) => format!("{note}\n{changes}"),
            None => changes,
        };
        content
            .push(json!({"type": "text", "text": format!("In {window}: {}", changes.trim_end())}));
    }
    Ok(json!({"content": content, "isError": failed}))
}

/// A batch's steps, each a tool and its arguments, or why `arguments` hold
/// none it runs.
fn stepped(arguments: &Map<String, Value>) -> Result<Vec<(Tool, Value)>, String> {
    let steps = arguments
        .get("steps")
        .and_then(Value::as_array)
        .ok_or("batch takes steps, an array of {tool, arguments}")?;
    if steps.is_empty() || steps.len() > MOST_STEPS {
        return Err(format!("batch takes 1 to {MOST_STEPS} steps"));
    }
    steps
        .iter()
        .enumerate()
        .map(|(number, step)| {
            let name = step["tool"].as_str().unwrap_or_default();
            match tool(name) {
                Some(Tool::Batch | Tool::AskToUse | Tool::StopUsing) => Err(format!(
                    "step {}: a batch holds no {name}; call it on its own",
                    number + 1
                )),
                Some(tool) => Ok((tool, step["arguments"].clone())),
                None => Err(format!("step {}: no tool {}", number + 1, step["tool"])),
            }
        })
        .collect()
}

/// The grant the user gives agent `name` when asked, or why there is none.
fn admitted(
    admit: &mut impl FnMut(&str) -> Result<Grant, String>,
    name: &str,
) -> Result<Grant, String> {
    admit(name).map_err(|why| {
        format!(
            "The user did not let {name} use this desktop ({}). If they ask you to try again, \
             call ask_to_use_desktop.",
            why.trim()
        )
    })
}

fn stopped(name: &str) -> String {
    format!(
        "The user stopped {name} from the desktop. If they ask you to use it again, call \
         ask_to_use_desktop."
    )
}

/// `ask_to_use_desktop`'s result: asks the user again unless the agent is in
/// now, dropping a grant they stopped first.
fn asked_again(
    admit: &mut impl FnMut(&str) -> Result<Grant, String>,
    session: &mut Session,
) -> Value {
    let name = session.name.clone();
    if let Some(Ok(grant)) = &session.grant {
        if !(grant.stopped)() {
            return said(
                true,
                format!("The user already lets {name} use this desktop."),
            );
        }
    }
    session.grant = None;
    let grant = admitted(admit, &name);
    let answer = match &grant {
        Ok(_) => said(true, format!("The user let {name} use this desktop.")),
        Err(why) => said(false, why.clone()),
    };
    session.grant = Some(grant);
    answer
}

/// `stop_using_desktop`'s result: drops the grant, which ends the agent's
/// `domicile agent` and its place in the bar, and what it read through it.
fn let_go(session: &mut Session) -> Value {
    let name = &session.name;
    session.view = None;
    session.read.clear();
    match session.grant.take() {
        Some(Ok(grant)) if !(grant.stopped)() => {
            said(true, format!("{name} no longer uses this desktop."))
        }
        _ => said(true, format!("{name} was not using this desktop.")),
    }
}

fn tool_is_listing_windows(tool: Tool) -> bool {
    matches!(tool, Tool::Listing("list-windows"))
}

/// Whether `tool` with `arguments` acts only on `windows`, the ones the user
/// shared with agent `name`, or why not.
fn within(
    tool: Tool,
    arguments: &Map<String, Value>,
    windows: &[domicile_protocol::AgentWindow],
    name: &str,
) -> Result<(), String> {
    let window = match tool {
        Tool::Listing("list-windows") => return Ok(()),
        Tool::WindowAct("close-window") => arguments.get("window"),
        Tool::Browser(_) | Tool::AppSnapshot | Tool::AppAct(_) => arguments.get("window"),
        _ => {
            return Err(format!(
                "The user shared only some windows with {name}, and this tool reaches the \
                 whole desktop. Use list_windows, then the browser_ and app_ tools on the \
                 windows it lists."
            ))
        }
    };
    match window.and_then(Value::as_str) {
        Some(id) if windows.iter().any(|shared| shared.id == id) => Ok(()),
        Some(id) => Err(format!(
            "The user did not share window {id} with {name}. list_windows lists the ones they did."
        )),
        // The tool says what it lacks.
        None => Ok(()),
    }
}

/// `list_windows`'s answer with only the windows `reach` reaches, noting
/// each one's title in `titles`.
fn listed_windows(
    answered: Value,
    reach: &AgentReach,
    titles: &mut HashMap<String, String>,
) -> Value {
    let Some(Ok(mut windows)) = answered["content"][0]["text"]
        .as_str()
        .map(serde_json::from_str::<Vec<Value>>)
    else {
        return answered;
    };
    for window in &windows {
        if let (Some(id), Some(title)) = (window["id"].as_str(), window["title"].as_str()) {
            titles.insert(id.to_string(), title.to_string());
        }
    }
    let AgentReach::Windows { windows: shared } = reach else {
        return answered;
    };
    windows.retain(|window| {
        shared
            .iter()
            .any(|shared| window["id"] == shared.id.as_str())
    });
    let mut printed = serde_json::to_string_pretty(&windows).expect("windows serialize");
    printed.push('\n');
    said(true, printed)
}

/// What the shell lists the agent as having done with `tool`. Never what
/// it typed, which may be a password.
fn what_it_did(
    tool: Tool,
    arguments: &Map<String, Value>,
    titles: &HashMap<String, String>,
) -> String {
    let window = |key: &str| {
        arguments
            .get(key)
            .and_then(Value::as_str)
            .map(|id| match titles.get(id) {
                Some(title) if !title.is_empty() => title.clone(),
                _ => "a window".to_string(),
            })
            .unwrap_or_else(|| "a window".to_string())
    };
    match tool {
        Tool::Listing("list-windows") => "Listed the windows".to_string(),
        Tool::Listing("list-displays") => "Listed the displays".to_string(),
        Tool::Listing("list-inputs") => "Listed the keyboards and pointers".to_string(),
        Tool::Listing("status") => "Read the desktop's status".to_string(),
        Tool::Listing(_) => "Read the shell's commands".to_string(),
        Tool::SendShell => "Ran a shell command".to_string(),
        Tool::Exec => "Started a program".to_string(),
        Tool::Open => "Opened something".to_string(),
        Tool::WindowAct("focus-window") => format!("Focused {}", window("id")),
        Tool::WindowAct(_) => format!("Closed {}", window("window")),
        Tool::Theme => "Changed the theme".to_string(),
        Tool::Screenshot => "Took a screenshot".to_string(),
        Tool::Click => "Clicked".to_string(),
        Tool::MovePointer => "Moved the pointer".to_string(),
        Tool::Drag => "Dragged".to_string(),
        Tool::Scroll => "Scrolled".to_string(),
        Tool::Key => "Pressed a key".to_string(),
        Tool::TypeText => "Typed".to_string(),
        Tool::Browser(Browser::Snapshot) | Tool::AppSnapshot => {
            format!("Read {}", window("window"))
        }
        Tool::Browser(Browser::Click) | Tool::AppAct("click") => {
            format!("Clicked in {}", window("window"))
        }
        Tool::Browser(Browser::Type) | Tool::AppAct("set-text") => {
            format!("Typed in {}", window("window"))
        }
        Tool::Browser(Browser::Drag) => format!("Dragged in {}", window("window")),
        Tool::Browser(Browser::Scroll) => format!("Scrolled in {}", window("window")),
        Tool::Browser(Browser::Key) => format!("Pressed a key in {}", window("window")),
        Tool::Browser(Browser::Navigate) => format!("Loaded a page in {}", window("window")),
        Tool::Browser(Browser::Screenshot) => format!("Took a screenshot of {}", window("window")),
        Tool::Browser(Browser::ChooseFiles) => {
            format!("Answered a file chooser in {}", window("window"))
        }
        Tool::AppAct(_) => format!("Moved the focus in {}", window("window")),
        Tool::AskToUse | Tool::StopUsing | Tool::Batch => {
            unreachable!("guarded answers ask_to_use_desktop, stop_using_desktop and batch itself")
        }
    }
}

/// Whether `tool` with `arguments` points or types with the agent's own
/// pointer and keyboard, which never move the user's (`--agent`), starts a
/// program whose windows that seat holds, or acts on a window that seat
/// holds: a shell command, or closing one.
fn on_its_own_seat(tool: Tool) -> bool {
    matches!(
        tool,
        Tool::SendShell
            | Tool::Exec
            | Tool::Open
            | Tool::Click
            | Tool::MovePointer
            | Tool::Drag
            | Tool::Scroll
            | Tool::Key
            | Tool::TypeText
            | Tool::WindowAct(_)
    )
}

/// `tools/call`'s result for `tool` with `arguments`. An act on a window
/// answers what it changed, unless `quiet`.
#[allow(clippy::too_many_arguments)] // Each is a separate part of the session.
fn called(
    tool: Tool,
    arguments: &Map<String, Value>,
    seat: u32,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    view: &mut Option<View>,
    read: &mut HashMap<String, String>,
    titles: &mut HashMap<String, String>,
    quiet: bool,
) -> io::Result<Value> {
    match tool {
        Tool::Screenshot => return screenshot(arguments, domicile, view),
        Tool::Browser(browser) => {
            let answer = browser::called(browser, arguments, seat, domicile, read, titles, quiet)?;
            return keyboard_follows_a_click(browser, arguments, seat, domicile, answer);
        }
        _ => {}
    }
    let mut runs = match commands(tool, arguments, *view) {
        Ok(runs) => runs,
        Err(why) => return Ok(said(false, why)),
    };
    if on_its_own_seat(tool) {
        for run in &mut runs {
            run.splice(1..1, ["--agent".to_string(), seat.to_string()]);
        }
    }
    // Each run in turn, up to the first that fails.
    let mut printed = String::new();
    for args in runs {
        let ran = domicile(&args)?;
        if !ran.success {
            return Ok(said(false, ran.stderr));
        }
        printed.push_str(&ran.stdout);
    }
    let window = string(arguments, "window").ok().flatten();
    match (tool, window) {
        (Tool::AppSnapshot, Some(window)) => {
            read.insert(window, printed.clone());
        }
        (Tool::AppAct(_), Some(window)) if !quiet => {
            std::thread::sleep(changes::SETTLE);
            printed.push_str(&app_read_again(&window, domicile, read)?);
        }
        _ => {}
    }
    Ok(said(true, printed))
}

/// `answer` to a browser tool, after a click gives the window it landed in
/// the agent's own keyboard, as a hand's click does, so `key` and
/// `type_text` type there. Says so when the window can't have it, such as
/// one the user is typing in. The shell's bars take no keyboard, and a
/// click in a view leaves it: the seat focuses a window's own page.
fn keyboard_follows_a_click(
    browser: Browser,
    arguments: &Map<String, Value>,
    seat: u32,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    mut answer: Value,
) -> io::Result<Value> {
    // A bad window or ref already made `answer` an error.
    let (Ok(Some(window)), Ok((None, _))) =
        (string(arguments, "window"), browser::aimed(arguments))
    else {
        return Ok(answer);
    };
    if browser != Browser::Click || window == browser::SHELL || answer["isError"] != false {
        return Ok(answer);
    }
    let ran = domicile(&[
        "focus-window".to_string(),
        "--agent".to_string(),
        seat.to_string(),
        window,
    ])?;
    if !ran.success {
        let text = &mut answer["content"][0]["text"];
        *text = Value::String(format!(
            "{}\nYour keyboard is not in it, so key and type_text can't type there: {}",
            text.as_str().expect("a browser tool answers text"),
            ran.stderr.trim_end()
        ));
    }
    Ok(answer)
}

/// What changed in native window `window` since it was last read, reading
/// it again into `read`, or that it could not be read again.
fn app_read_again(
    window: &str,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    read: &mut HashMap<String, String>,
) -> io::Result<String> {
    let ran = domicile(&[
        "accessibility".to_string(),
        "--window".to_string(),
        window.to_string(),
    ])?;
    if !ran.success {
        return Ok(format!("It could not be read again: {}", ran.stderr));
    }
    let changes = changes::changed(
        read.get(window).map(String::as_str),
        &ran.stdout,
        "app_snapshot",
    );
    read.insert(window.to_string(), ran.stdout);
    Ok(changes)
}

/// The runs of `domicile` that carry out `tool`, or why `arguments` don't
/// make any.
fn commands(
    tool: Tool,
    arguments: &Map<String, Value>,
    view: Option<View>,
) -> Result<Vec<Vec<String>>, String> {
    let words = |words: &[&str]| words.iter().map(|word| word.to_string()).collect();
    match tool {
        Tool::Listing(verb) => Ok(vec![words(&[verb, "--json"])]),
        Tool::SendShell => {
            let said = arguments
                .get("words")
                .and_then(Value::as_array)
                .ok_or("send_shell takes words, an array of strings")?;
            let said = said
                .iter()
                .map(|word| word.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .ok_or("send_shell's words are strings")?;
            Ok(taking(arguments, [words(&["send-shell"]), said].concat())?)
        }
        Tool::Exec => {
            let argv = arguments
                .get("argv")
                .and_then(Value::as_array)
                .ok_or("exec takes argv, an array of strings")?;
            let argv = argv
                .iter()
                .map(|word| word.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .ok_or("exec's argv are strings")?;
            match argv.is_empty() {
                true => Err("exec's argv names no program".to_string()),
                false => Ok(vec![[words(&["exec"]), argv].concat()]),
            }
        }
        Tool::Open => {
            let target = string(arguments, "target")?.ok_or("open takes a target")?;
            let app = match arguments.get("app") {
                None => false,
                Some(app) => app.as_bool().ok_or("open's app is true or false")?,
            };
            let profile = string(arguments, "profile")?;
            Ok(vec![[
                words(&["open"]),
                app.then(|| "--app".to_string()).into_iter().collect(),
                profile
                    .map(|profile| vec!["--profile".to_string(), profile])
                    .unwrap_or_default(),
                vec![target],
            ]
            .concat()])
        }
        Tool::WindowAct("focus-window") => {
            let id = string(arguments, "id")?.ok_or("focus_window takes a window id")?;
            Ok(vec![words(&["focus-window", &id])])
        }
        Tool::WindowAct(verb) => taking(arguments, words(&[verb])),
        Tool::Theme => Ok(vec![[
            words(&["theme"]),
            string(arguments, "change")?.into_iter().collect(),
        ]
        .concat()]),
        Tool::Screenshot | Tool::Browser(_) => {
            unreachable!("screenshot and the browser tools are not single runs")
        }
        Tool::Click => {
            let at = on_the_desk(view, number(arguments, "x")?, number(arguments, "y")?)?;
            let action = match (string(arguments, "button")?.as_deref(), arguments.get("count")) {
                (None | Some("left"), None) => "click",
                (None | Some("left"), Some(count)) if count == 1 => "click",
                (None | Some("left"), Some(count)) if count == 2 => "double-click",
                (Some("right"), None) => "right-click",
                (Some("middle"), None) => "middle-click",
                _ => return Err("click takes a left, right or middle button, and a count of 1 or 2 for the left one".to_string()),
            };
            Ok(vec![words(&["pointer", &at, action])])
        }
        Tool::MovePointer => {
            let at = on_the_desk(view, number(arguments, "x")?, number(arguments, "y")?)?;
            Ok(vec![words(&["pointer", &at])])
        }
        Tool::Drag => {
            let (from, to) = (pair(arguments, "from")?, pair(arguments, "to")?);
            Ok(vec![words(&[
                "drag",
                &on_the_desk(view, from.0, from.1)?,
                &on_the_desk(view, to.0, to.1)?,
            ])])
        }
        Tool::Scroll => {
            let at = on_the_desk(view, number(arguments, "x")?, number(arguments, "y")?)?;
            let by = across_the_desk(view, number(arguments, "dx")?, number(arguments, "dy")?)?;
            Ok(vec![words(&["pointer", &at]), words(&["scroll", &by])])
        }
        // The seat's keyboard takes a named window as it presses.
        Tool::Key => {
            let chord = string(arguments, "chord")?.ok_or("key takes a chord")?;
            Ok(vec![
                [words(&["key"]), aimed(arguments)?, vec![chord]].concat()
            ])
        }
        Tool::TypeText => {
            let text = string(arguments, "text")?.ok_or("type_text takes text")?;
            Ok(vec![
                [words(&["type"]), aimed(arguments)?, vec![text]].concat()
            ])
        }
        Tool::AppSnapshot => {
            let window = string(arguments, "window")?.ok_or("app_snapshot takes a window id")?;
            Ok(vec![words(&["accessibility", "--window", &window])])
        }
        Tool::AppAct(act) => {
            let window = string(arguments, "window")?.ok_or("this tool takes a window id")?;
            let element = string(arguments, "ref")?.ok_or("this tool takes an element's ref")?;
            let text = match act {
                "set-text" => vec![string(arguments, "text")?.ok_or("app_set_text takes text")?],
                _ => Vec::new(),
            };
            Ok(vec![[
                words(&["accessibility-act", "--window", &window]),
                vec![element, act.to_string()],
                text,
            ]
            .concat()])
        }
        Tool::AskToUse | Tool::StopUsing | Tool::Batch => {
            unreachable!("guarded answers ask_to_use_desktop, stop_using_desktop and batch itself")
        }
    }
}

/// `--window` and the window `arguments` name, or nothing for the window the
/// seat's keyboard is in.
fn aimed(arguments: &Map<String, Value>) -> Result<Vec<String>, String> {
    Ok(match string(arguments, "window")? {
        Some(window) => vec!["--window".to_string(), window],
        None => Vec::new(),
    })
}

/// `run` aimed as [`aimed`] aims it, after the seat takes the window it names
/// with its keyboard: the compositor and the launcher act only on a window the
/// seat holds.
fn taking(arguments: &Map<String, Value>, run: Vec<String>) -> Result<Vec<Vec<String>>, String> {
    let (verb, rest) = run.split_first().expect("a run names its verb");
    Ok(match string(arguments, "window")? {
        None => vec![run],
        Some(window) => vec![
            vec!["focus-window".to_string(), window.clone()],
            [vec![verb.clone()], aimed(arguments)?, rest.to_vec()].concat(),
        ],
    })
}

/// `x`, `y` in the last screenshot's pixels as `x,y` in the desk's, as
/// `domicile pointer` and `scroll` take them.
fn on_the_desk(view: Option<View>, x: f64, y: f64) -> Result<String, String> {
    let view = taken(view)?;
    Ok(format!(
        "{},{}",
        view.left + x * view.across,
        view.top + y * view.down
    ))
}

/// A distance `dx`, `dy` in the last screenshot's pixels as one in the
/// desk's, as `domicile scroll` takes it.
fn across_the_desk(view: Option<View>, dx: f64, dy: f64) -> Result<String, String> {
    let view = taken(view)?;
    Ok(format!("{},{}", dx * view.across, dy * view.down))
}

/// The last screenshot's view, or why there is none.
fn taken(view: Option<View>) -> Result<View, String> {
    view.ok_or_else(|| "take a screenshot first: points are in its pixels".to_string())
}

/// Argument `area`, `[x, y, width, height]` of the last screenshot, as the
/// area of the desk `domicile screenshot --area` takes, rounded out to whole
/// pixels.
fn desk_area(view: Option<View>, arguments: &Map<String, Value>) -> Result<Option<String>, String> {
    let Some(area) = arguments.get("area") else {
        return Ok(None);
    };
    let not_an_area = || format!("area is [x, y, width, height], not {area}");
    let numbers: Vec<f64> = area
        .as_array()
        .ok_or_else(not_an_area)?
        .iter()
        .map(Value::as_f64)
        .collect::<Option<_>>()
        .ok_or_else(not_an_area)?;
    let [x, y, width, height] = numbers.as_slice() else {
        return Err(not_an_area());
    };
    let view = taken(view)?;
    let left = (view.left + x * view.across).floor();
    let top = (view.top + y * view.down).floor();
    let right = (view.left + (x + width) * view.across).ceil();
    let bottom = (view.top + (y + height) * view.down).ceil();
    Ok(Some(format!(
        "{left},{top},{}x{}",
        right - left,
        bottom - top
    )))
}

/// Argument `name`, a number.
fn number(arguments: &Map<String, Value>, name: &str) -> Result<f64, String> {
    arguments
        .get(name)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("{name} is a number"))
}

/// Argument `name`, a point as `[x, y]`.
fn pair(arguments: &Map<String, Value>, name: &str) -> Result<(f64, f64), String> {
    match arguments
        .get(name)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        Some([x, y]) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => Ok((x, y)),
            _ => Err(format!("{name} is two numbers, [x, y]")),
        },
        _ => Err(format!("{name} is two numbers, [x, y]")),
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

/// Runs `domicile screenshot --fit` into a temporary file, of argument
/// `area` of the last screenshot if given, answers the PNG, and keeps how its
/// pixels map to the desk's in `view`.
fn screenshot(
    arguments: &Map<String, Value>,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    view: &mut Option<View>,
) -> io::Result<Value> {
    let area = match desk_area(*view, arguments) {
        Ok(area) => area,
        Err(why) => return Ok(said(false, why)),
    };
    let directory = tempfile::tempdir()?;
    let file = directory.path().join("screenshot.png");
    let ran = domicile(
        &[
            "screenshot".to_string(),
            "--fit".to_string(),
            FIT.to_string(),
        ]
        .into_iter()
        .chain(
            area.into_iter()
                .flat_map(|area| ["--area".to_string(), area]),
        )
        .chain([file.to_string_lossy().into_owned()])
        .collect::<Vec<_>>(),
    )?;
    if !ran.success {
        return Ok(said(false, ran.stderr));
    }
    let shot: DeskShot = serde_json::from_str(&ran.stdout).map_err(|why| {
        io::Error::other(format!(
            "domicile screenshot --fit printed {:?}, which is not what a shot shows: {why}",
            ran.stdout
        ))
    })?;
    *view = Some(View {
        left: f64::from(shot.place.position.0),
        top: f64::from(shot.place.position.1),
        across: f64::from(shot.place.size.0) / f64::from(shot.width),
        down: f64::from(shot.place.size.1) / f64::from(shot.height),
    });
    let png = std::fs::read(&file)?;
    Ok(json!({
        "content": [
            {"type": "image", "data": STANDARD.encode(&png), "mimeType": "image/png"},
            {"type": "text", "text": format!("{}x{} pixels; the pointer tools take points in them.", shot.width, shot.height)},
        ],
        "isError": false,
    }))
}

/// A tool result of text.
fn said(success: bool, text: String) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": !success})
}
