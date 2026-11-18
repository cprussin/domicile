//! `domicile mcp`'s browser tools: a browser window's page read as its
//! accessibility tree and driven by the elements in it, through `domicile
//! devtools`. They need no screenshot and work on a window the desk hides.

use std::io;

use serde_json::{json, Map, Value};

use super::{said, string, Ran};

/// A browser tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Browser {
    Snapshot,
    Click,
    Type,
    Key,
    Navigate,
    Screenshot,
}

/// The longest name or value a snapshot shows of one element, in characters.
const LONGEST: usize = 200;

/// A browser tool's description, its arguments' JSON schemas and which are
/// required.
pub(super) fn described(tool: Browser) -> (&'static str, Value, Vec<&'static str>) {
    let window =
        json!({"type": "string", "description": "A browser window's id, from list_windows."});
    let element =
        json!({"type": "integer", "description": "An element's ref, from browser_snapshot."});
    match tool {
        Browser::Snapshot => (
            "Read a browser window's page as its accessibility tree: one element a line, with the ref the other browser tools take. Works on hidden windows; private ones are refused.",
            json!({"window": window}),
            vec!["window"],
        ),
        Browser::Click => (
            "Click an element of a browser window's page by its ref, scrolling it into view first.",
            json!({"window": window, "ref": element}),
            vec!["window", "ref"],
        ),
        Browser::Type => (
            "Type text into a browser window's page: into the element with ref, focusing it first, or where its focus is.",
            json!({"window": window, "ref": element, "text": {"type": "string"}}),
            vec!["window", "text"],
        ),
        Browser::Key => (
            "Press and release a key in a browser window's page.",
            json!({"window": window, "key": {"type": "string", "enum": KEYS.iter().map(|key| key.0).collect::<Vec<_>>()}}),
            vec!["window", "key"],
        ),
        Browser::Navigate => (
            "Load an http or https address in a browser window.",
            json!({"window": window, "url": {"type": "string"}}),
            vec!["window", "url"],
        ),
        Browser::Screenshot => (
            "Take a WebP of a browser window's page as it draws, hidden or not.",
            json!({"window": window}),
            vec!["window"],
        ),
    }
}

/// `tools/call`'s result for browser tool `tool` with `arguments`.
pub(super) fn called(
    tool: Browser,
    arguments: &Map<String, Value>,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<Value> {
    let window = match string(arguments, "window") {
        Ok(Some(window)) => window,
        Ok(None) => return Ok(said(false, "this tool takes a window id".to_string())),
        Err(why) => return Ok(said(false, why)),
    };
    let mut page = Page { window, domicile };
    Ok(match carried_out(tool, arguments, &mut page)? {
        Ok(answer) => answer,
        Err(why) => said(false, why),
    })
}

/// A browser window's page, which `domicile devtools` sends methods to.
struct Page<'a, D> {
    window: String,
    domicile: &'a mut D,
}

impl<D: FnMut(&[String]) -> io::Result<Ran>> Page<'_, D> {
    /// `method`'s result, or why there is none.
    fn send(&mut self, method: &str, params: Value) -> io::Result<Result<Value, String>> {
        let ran = (self.domicile)(&[
            "devtools".to_string(),
            self.window.clone(),
            method.to_string(),
            params.to_string(),
        ])?;
        if !ran.success {
            return Ok(Err(ran.stderr));
        }
        serde_json::from_str(&ran.stdout).map(Ok).map_err(|why| {
            io::Error::other(format!(
                "domicile devtools printed {:?}, which is not JSON: {why}",
                ran.stdout
            ))
        })
    }
}

/// Sends `$method` with `$params`, returning the tool's refusal if it fails.
macro_rules! sent {
    ($page:expr, $method:expr, $params:expr) => {
        match $page.send($method, $params)? {
            Ok(result) => result,
            Err(why) => return Ok(Err(why)),
        }
    };
}

fn carried_out<D: FnMut(&[String]) -> io::Result<Ran>>(
    tool: Browser,
    arguments: &Map<String, Value>,
    page: &mut Page<'_, D>,
) -> io::Result<Result<Value, String>> {
    let element = match element(arguments) {
        Ok(element) => element,
        Err(why) => return Ok(Err(why)),
    };
    match tool {
        Browser::Snapshot => {
            let tree = sent!(page, "Accessibility.getFullAXTree", json!({}));
            Ok(Ok(said(true, outline(&tree))))
        }
        Browser::Click => {
            let Some(element) = element else {
                return Ok(Err("browser_click takes the ref of an element".to_string()));
            };
            let node = json!({"backendNodeId": element});
            sent!(page, "DOM.scrollIntoViewIfNeeded", node.clone());
            let quads = sent!(page, "DOM.getContentQuads", node);
            let Some((x, y)) = middle(&quads) else {
                return Ok(Err(format!(
                    "element {element} has no box on the page to click; it may be hidden"
                )));
            };
            for kind in ["mouseMoved", "mousePressed", "mouseReleased"] {
                sent!(
                    page,
                    "Input.dispatchMouseEvent",
                    json!({"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1})
                );
            }
            Ok(Ok(said(true, format!("clicked element {element}"))))
        }
        Browser::Type => {
            let text = match string(arguments, "text") {
                Ok(Some(text)) => text,
                Ok(None) => return Ok(Err("browser_type takes text".to_string())),
                Err(why) => return Ok(Err(why)),
            };
            if let Some(element) = element {
                sent!(page, "DOM.focus", json!({"backendNodeId": element}));
            }
            sent!(page, "Input.insertText", json!({"text": text}));
            Ok(Ok(said(true, "typed".to_string())))
        }
        Browser::Key => {
            let named = string(arguments, "key").ok().flatten();
            let Some(&(key, code, vk, text)) =
                KEYS.iter().find(|known| Some(known.0) == named.as_deref())
            else {
                return Ok(Err(format!(
                    "browser_key takes one of {}",
                    KEYS.iter().map(|key| key.0).collect::<Vec<_>>().join(", ")
                )));
            };
            let mut down =
                json!({"type": "keyDown", "key": key, "code": code, "windowsVirtualKeyCode": vk});
            if let Some(text) = text {
                down["text"] = json!(text);
            }
            sent!(page, "Input.dispatchKeyEvent", down);
            sent!(
                page,
                "Input.dispatchKeyEvent",
                json!({"type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk})
            );
            Ok(Ok(said(true, format!("pressed {key}"))))
        }
        Browser::Navigate => {
            let url = match string(arguments, "url") {
                Ok(Some(url)) => url,
                Ok(None) => return Ok(Err("browser_navigate takes a url".to_string())),
                Err(why) => return Ok(Err(why)),
            };
            let navigated = sent!(page, "Page.navigate", json!({"url": url}));
            match navigated["errorText"].as_str() {
                Some(why) if !why.is_empty() => Ok(Err(format!("{url} did not load: {why}"))),
                _ => Ok(Ok(said(true, format!("loading {url}")))),
            }
        }
        Browser::Screenshot => {
            let shot = sent!(
                page,
                "Page.captureScreenshot",
                json!({"format": "webp", "quality": 70})
            );
            let Some(data) = shot["data"].as_str() else {
                return Ok(Err("the page answered no image".to_string()));
            };
            Ok(Ok(json!({
                "content": [{"type": "image", "data": data, "mimeType": "image/webp"}],
                "isError": false,
            })))
        }
    }
}

/// The keys `browser_key` presses: the key's name, its code, its Windows
/// virtual key code, and the text it types, if any.
const KEYS: [(&str, &str, u32, Option<&str>); 14] = [
    ("Enter", "Enter", 13, Some("\r")),
    ("Tab", "Tab", 9, None),
    ("Escape", "Escape", 27, None),
    ("Backspace", "Backspace", 8, None),
    ("Delete", "Delete", 46, None),
    ("Space", "Space", 32, Some(" ")),
    ("ArrowUp", "ArrowUp", 38, None),
    ("ArrowDown", "ArrowDown", 40, None),
    ("ArrowLeft", "ArrowLeft", 37, None),
    ("ArrowRight", "ArrowRight", 39, None),
    ("Home", "Home", 36, None),
    ("End", "End", 35, None),
    ("PageUp", "PageUp", 33, None),
    ("PageDown", "PageDown", 34, None),
];

/// Argument `ref`, an element's ref from a snapshot, if given.
fn element(arguments: &Map<String, Value>) -> Result<Option<u64>, String> {
    match arguments.get("ref") {
        None => Ok(None),
        Some(element) => element.as_u64().map(Some).ok_or_else(|| {
            format!("ref is an element's number from browser_snapshot, not {element}")
        }),
    }
}

/// The middle of the first quad DOM.getContentQuads answers, in the page's
/// CSS pixels, as Input.dispatchMouseEvent takes them.
fn middle(quads: &Value) -> Option<(f64, f64)> {
    let quad: Vec<f64> = quads["quads"]
        .get(0)?
        .as_array()?
        .iter()
        .map(Value::as_f64)
        .collect::<Option<_>>()?;
    let [x1, y1, x2, y2, x3, y3, x4, y4] = quad.as_slice() else {
        return None;
    };
    Some(((x1 + x2 + x3 + x4) / 4.0, (y1 + y2 + y3 + y4) / 4.0))
}

/// Roles that only group others, which a snapshot leaves out unless named.
const GROUPING: [&str; 5] = [
    "generic",
    "none",
    "presentation",
    "InlineTextBox",
    "LineBreak",
];

/// Accessibility.getFullAXTree's nodes as an indented outline, one element a
/// line: its role, name, ref, value and states. Ignored and unnamed grouping
/// nodes give their place to their children, and text that repeats its
/// parent's name is left out.
fn outline(tree: &Value) -> String {
    let nodes: Vec<&Value> = tree["nodes"]
        .as_array()
        .map_or(Vec::new(), |nodes| nodes.iter().collect());
    let by_id: std::collections::HashMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| Some((node["nodeId"].as_str()?, *node)))
        .collect();
    let mut lines = String::new();
    if let Some(root) = nodes.first() {
        write_node(root, &by_id, 0, "", &mut lines);
    }
    lines
}

fn write_node(
    node: &Value,
    by_id: &std::collections::HashMap<&str, &Value>,
    depth: usize,
    parent_name: &str,
    lines: &mut String,
) {
    let role = node["role"]["value"].as_str().unwrap_or("");
    let name = node["name"]["value"].as_str().unwrap_or("");
    let ignored = node["ignored"].as_bool().unwrap_or(false);
    let shown = !ignored
        && !(name.is_empty() && GROUPING.contains(&role))
        && !(role == "StaticText" && (name.is_empty() || name == parent_name));
    let (depth_below, name_below) = if shown {
        lines.push_str(&"  ".repeat(depth));
        lines.push_str("- ");
        lines.push_str(role);
        if !name.is_empty() {
            lines.push_str(&format!(" {:?}", shortened(name)));
        }
        if let Some(element) = node["backendDOMNodeId"].as_u64() {
            lines.push_str(&format!(" [ref={element}]"));
        }
        if let Some(value) = node["value"]["value"]
            .as_str()
            .filter(|value| !value.is_empty())
        {
            lines.push_str(&format!(" value={:?}", shortened(value)));
        }
        for property in node["properties"].as_array().into_iter().flatten() {
            let state = property["name"].as_str().unwrap_or("");
            let value = &property["value"]["value"];
            match state {
                "focused" | "disabled" | "required" | "readonly" | "modal" if value == true => {
                    lines.push(' ');
                    lines.push_str(state);
                }
                "checked" | "pressed" | "expanded" | "selected" => {
                    lines.push_str(&format!(" {state}={value}"));
                }
                _ => {}
            }
        }
        lines.push('\n');
        (depth + 1, name)
    } else {
        (depth, parent_name)
    };
    for child in node["childIds"].as_array().into_iter().flatten() {
        if let Some(child) = child.as_str().and_then(|id| by_id.get(id)) {
            write_node(child, by_id, depth_below, name_below, lines);
        }
    }
}

/// `text` cut to [`LONGEST`] characters.
fn shortened(text: &str) -> String {
    match text.char_indices().nth(LONGEST) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
}
