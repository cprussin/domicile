//! `domicile mcp`'s browser tools: a browser window's page, and each view it
//! holds, read as its accessibility tree and driven by the elements in it,
//! through `domicile devtools`. They need no screenshot and work on a window
//! the desk hides.

use std::collections::HashMap;
use std::io;

use domicile_protocol::ListedView;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::changes::{changed, SETTLE};
use super::{number, pair, said, string, Ran};
use crate::accessibility::MOST;

/// A browser tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Browser {
    Snapshot,
    Click,
    Drag,
    Scroll,
    Type,
    Key,
    Navigate,
    Screenshot,
    ChooseFiles,
}

/// The window the browser tools name to reach the shell's own page: its
/// bars, panels and dialogs.
pub(super) const SHELL: &str = crate::control::SHELL_WINDOW;

/// The longest name or value a snapshot shows of one element, in characters.
const LONGEST: usize = 200;

/// A browser tool's description, its arguments' JSON schemas and which are
/// required.
pub(super) fn described(tool: Browser) -> (&'static str, Value, Vec<&'static str>) {
    let window = json!({"type": "string", "description": "A browser window's id, from list_windows, or \"shell\" for the shell's own bars, panels and dialogs. Left out, the window your keyboard is in."});
    let element =
        json!({"type": "string", "description": "An element's ref, from browser_snapshot."});
    let view = json!({"type": "string", "description": "One of the window's views, from browser_snapshot or list_windows. Left out, the window's own page."});
    let at = json!({"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2, "description": "[x, y] in the pixels of browser_screenshot of the same page or view."});
    match tool {
        Browser::Snapshot => (
            "Read a browser window's page, then each view it holds, as accessibility trees: one element a line, with the ref the other browser tools take. An Electron app such as Claude or Slack draws its page in views. Works on hidden windows; private ones are refused.",
            json!({"window": window}),
            vec![],
        ),
        Browser::Click => (
            "Click an element of a browser window's page or view by its ref, scrolling it into view first, or at a point `at` of the page, for a canvas or anything else with no ref. The user's pointer and focus stay where they are. Answers what it changed in the window.",
            json!({
                "window": window,
                "ref": element,
                "view": view,
                "at": at.clone(),
                "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "Left out, the left one."},
                "count": {"type": "integer", "enum": [1, 2], "description": "2 double-clicks. Left out, 1."},
            }),
            vec![],
        ),
        Browser::Drag => (
            "Press the left button at point `from` of a browser window's page or view, move to `to` and let go, as on a canvas. The user's pointer and focus stay where they are. Answers what it changed in the window.",
            json!({"window": window, "view": view, "from": at.clone(), "to": at.clone()}),
            vec!["from", "to"],
        ),
        Browser::Scroll => (
            "Scroll a browser window's page or view with the wheel at point `at`, by `by`, [right, down], in the same pixels. The user's pointer stays where it is. Answers what it changed in the window.",
            json!({"window": window, "view": view, "at": at.clone(), "by": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2, "description": "[right, down]; negative goes left or up."}}),
            vec!["at", "by"],
        ),
        Browser::Type => (
            "Type text into a browser window's page or view: into the element with ref, focusing it first, or where its focus is. Never into the window the user is typing in. Answers what it changed in the window.",
            json!({"window": window, "ref": element, "view": view, "text": {"type": "string"}}),
            vec!["text"],
        ),
        Browser::Key => (
            "Press and release a key in a browser window's page or view. Answers what it changed in the window.",
            json!({"window": window, "view": view, "key": {"type": "string", "enum": KEYS.iter().map(|key| key.0).collect::<Vec<_>>()}}),
            vec!["key"],
        ),
        Browser::Navigate => (
            "Load an http or https address in a browser window. Answers what it changed in the window.",
            json!({"window": window, "url": {"type": "string"}}),
            vec!["url"],
        ),
        Browser::Screenshot => (
            "Take a WebP of a browser window's page or view as it draws, hidden or not.",
            json!({"window": window, "view": view}),
            vec![],
        ),
        Browser::ChooseFiles => (
            "Answer the file chooser your click or key opened in a browser window's page or view, such as an upload button's: give it `paths`, absolute, or `cancel`. The acts say when a page waits on one; the user never sees it. Answers what it changed in the window.",
            json!({
                "window": window,
                "view": view,
                "paths": {"type": "array", "items": {"type": "string"}, "description": "Absolute paths: files to open, a folder, or where to save, as the chooser asks."},
                "cancel": {"type": "boolean", "description": "true cancels the chooser instead."},
            }),
            vec![],
        ),
    }
}

/// `tools/call`'s result for browser tool `tool` with `arguments`. A read
/// keeps the window's outline in `read`; an act answers what it changed,
/// unless `quiet`, for a batch that reads the window once at its end. Each
/// read notes the title of the page the window shows in `titles`. Its methods
/// are sent for agent session `seat`, so a page it drives copies to and pastes
/// from that agent's own clipboard.
pub(super) fn called(
    tool: Browser,
    arguments: &Map<String, Value>,
    seat: u32,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    read: &mut HashMap<String, String>,
    titles: &mut HashMap<String, String>,
    quiet: bool,
) -> io::Result<Value> {
    let window = match string(arguments, "window") {
        Ok(Some(window)) => window,
        Ok(None) => return Ok(said(false, "this tool takes a window id".to_string())),
        Err(why) => return Ok(said(false, why)),
    };
    let (view, element) = match aimed(arguments) {
        Ok(aim) => aim,
        Err(why) => return Ok(said(false, why)),
    };
    let mut page = Page {
        window,
        agent: Some(seat),
        view,
        domicile,
        title: None,
    };
    let answer = carried_out(tool, arguments, element, &mut page);
    if let Some(title) = page.title.take() {
        titles.insert(page.window.clone(), title);
    }
    let answer = match answer? {
        Ok(answer) => answer,
        Err(why) => return Ok(said(false, why)),
    };
    if quiet || !acts(tool) {
        if tool == Browser::Snapshot {
            let outline = answer["content"][0]["text"]
                .as_str()
                .expect("a browser tool answers text");
            read.insert(page.window.clone(), outline.to_string());
        }
        return Ok(answer);
    }
    let did = answer["content"][0]["text"]
        .as_str()
        .expect("a browser tool answers text");
    std::thread::sleep(SETTLE);
    let did = match presses(tool) {
        true => match chooser_note(&page.window, page.view.clone(), page.domicile)? {
            Some(note) => format!("{did}\n{note}"),
            None => did.to_string(),
        },
        false => did.to_string(),
    };
    let changes = read_again(&page.window, page.domicile, read, titles)?;
    Ok(said(true, format!("{did}\n{changes}")))
}

/// Whether `tool` acts on a window, rather than reading it.
pub(super) fn acts(tool: Browser) -> bool {
    match tool {
        Browser::Snapshot | Browser::Screenshot => false,
        Browser::Click
        | Browser::Drag
        | Browser::Scroll
        | Browser::Type
        | Browser::Key
        | Browser::Navigate
        | Browser::ChooseFiles => true,
    }
}

/// Whether `tool` presses or keys in a page, the only acts that let it open
/// a file chooser.
pub(super) fn presses(tool: Browser) -> bool {
    matches!(
        tool,
        Browser::Click | Browser::Drag | Browser::Key | Browser::ChooseFiles
    )
}

/// That browser window `window`'s page, or its view `view`, waits on a file
/// chooser, or that whether it does could not be read, if either.
pub(super) fn chooser_note(
    window: &str,
    view: Option<String>,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
) -> io::Result<Option<String>> {
    let mut page = Page {
        window: window.to_string(),
        agent: None,
        view,
        domicile,
        title: None,
    };
    Ok(match waiting_chooser(&mut page)? {
        Ok(chooser) => chooser,
        Err(why) => Some(format!(
            "Whether it opened a file chooser could not be read: {why}"
        )),
    })
}

/// What changed in browser window `window` since it was last read, reading
/// it again into `read`, or that it could not be read again.
pub(super) fn read_again(
    window: &str,
    domicile: &mut impl FnMut(&[String]) -> io::Result<Ran>,
    read: &mut HashMap<String, String>,
    titles: &mut HashMap<String, String>,
) -> io::Result<String> {
    let mut page = Page {
        window: window.to_string(),
        agent: None,
        view: None,
        domicile,
        title: None,
    };
    let after = match outline_of(&mut page)? {
        Ok(after) => after,
        Err(why) => return Ok(format!("It could not be read again: {why}")),
    };
    if let Some(title) = page.title.take() {
        titles.insert(window.to_string(), title);
    }
    let changes = changed(
        read.get(window).map(String::as_str),
        &after,
        "browser_snapshot",
    );
    read.insert(window.to_string(), after);
    Ok(changes)
}

/// A browser window's page, or its view `view`, which `domicile devtools`
/// sends methods to.
struct Page<'a, D> {
    window: String,
    /// The agent session its input methods are sent for, for an act; none
    /// for a read.
    agent: Option<u32>,
    view: Option<String>,
    domicile: &'a mut D,
    /// The title of the window's page as last read, if it was.
    title: Option<String>,
}

impl<D: FnMut(&[String]) -> io::Result<Ran>> Page<'_, D> {
    /// `method`'s result, or why there is none.
    fn send(&mut self, method: &str, params: Value) -> io::Result<Result<Value, String>> {
        // Only input says who drove the page, which is what the engine keys
        // the page's clipboard on.
        let agent = self
            .agent
            .filter(|_| method.starts_with("Input."))
            .into_iter()
            .flat_map(|agent| ["--agent".to_string(), agent.to_string()]);
        let view = self
            .view
            .iter()
            .flat_map(|view| ["--view".to_string(), view.clone()]);
        let ran = (self.domicile)(
            &std::iter::once("devtools".to_string())
                .chain(agent)
                .chain(["--window".to_string(), self.window.clone()])
                .chain(view)
                .chain([method.to_string(), params.to_string()])
                .collect::<Vec<_>>(),
        )?;
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

    /// How many of a screenshot's pixels make one of the page's CSS pixels:
    /// its device pixel ratio, which Page.captureScreenshot draws at and
    /// Input.dispatchMouseEvent divides out. Page.getLayoutMetrics gives the
    /// visual viewport's width in device pixels and in CSS pixels, unrounded;
    /// the layout viewport's are rounded.
    fn scale(&mut self) -> io::Result<Result<f64, String>> {
        let answer = match self.send("Page.getLayoutMetrics", json!({}))? {
            Ok(answer) => answer,
            Err(why) => return Ok(Err(why)),
        };
        let device = answer["visualViewport"]["clientWidth"].as_f64();
        let css = answer["cssVisualViewport"]["clientWidth"].as_f64();
        Ok(device
            .zip(css)
            .filter(|(device, css)| *device > 0.0 && *css > 0.0)
            .map(|(device, css)| device / css)
            .ok_or_else(|| format!("the page answered no viewport width: {answer}")))
    }

    /// The views the window holds, as `domicile list-windows` lists them, or
    /// why there are none.
    fn views(&mut self) -> io::Result<Result<Vec<ListedView>, String>> {
        let ran = (self.domicile)(&["list-windows".to_string(), "--json".to_string()])?;
        if !ran.success {
            return Ok(Err(ran.stderr));
        }
        let windows: Vec<Listed> = serde_json::from_str(&ran.stdout).map_err(|why| {
            io::Error::other(format!(
                "domicile list-windows printed {:?}, which is not its windows: {why}",
                ran.stdout
            ))
        })?;
        Ok(windows
            .into_iter()
            .find(|listed| listed.id == self.window)
            .map(|listed| listed.views)
            .ok_or_else(|| format!("window {} closed", self.window)))
    }
}

/// What the browser tools read of a window `domicile list-windows` lists.
#[derive(Deserialize)]
struct Listed {
    id: String,
    views: Vec<ListedView>,
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

/// The file chooser the page or view waits on for the agent, said for the
/// agent, or nothing when none waits. The shell's own page asks no agent.
fn waiting_chooser<D: FnMut(&[String]) -> io::Result<Ran>>(
    page: &mut Page<'_, D>,
) -> io::Result<Result<Option<String>, String>> {
    if page.window == SHELL {
        return Ok(Ok(None));
    }
    let answer = sent!(page, "Domicile.fileChooser", json!({}));
    let chooser = &answer["chooser"];
    if chooser.is_null() {
        return Ok(Ok(None));
    }
    let asks = match chooser["mode"].as_str() {
        Some("open") => "a file",
        Some("open-multiple") => "one or more files",
        Some("open-folder") => "a folder",
        Some("save") => "where to save",
        _ => {
            return Ok(Err(format!(
                "the engine described a chooser it can't: {chooser}"
            )))
        }
    };
    let Some(accept) = chooser["accept"].as_array().and_then(|accept| {
        accept
            .iter()
            .map(|extension| extension.as_str().map(|extension| format!(".{extension}")))
            .collect::<Option<Vec<_>>>()
    }) else {
        return Ok(Err(format!(
            "the engine described a chooser it can't: {chooser}"
        )));
    };
    let mut said = format!("The page waits on a file chooser for {asks}");
    if !accept.is_empty() {
        said.push_str(&format!(", accepting {}", accept.join(", ")));
    }
    match chooser["suggestedName"].as_str() {
        Some("") => {}
        Some(name) => said.push_str(&format!(", suggesting {name}")),
        None => {
            return Ok(Err(format!(
                "the engine described a chooser it can't: {chooser}"
            )))
        }
    }
    said.push_str(": answer it with browser_choose_files.");
    Ok(Ok(Some(said)))
}

/// The window's page, then each view it holds, as outlines, or why they
/// can't be read.
fn outline_of<D: FnMut(&[String]) -> io::Result<Ran>>(
    page: &mut Page<'_, D>,
) -> io::Result<Result<String, String>> {
    let tree = sent!(page, "Accessibility.getFullAXTree", json!({}));
    page.title = tree["nodes"][0]["name"]["value"]
        .as_str()
        .map(str::to_string);
    let mut lines = outline(&tree, 0, "");
    // The shell's page holds no views, and is no window list-windows lists.
    if page.window == SHELL {
        return Ok(Ok(lines));
    }
    let views = match page.views()? {
        Ok(views) => views,
        Err(why) => return Ok(Err(why)),
    };
    for view in views {
        page.view = Some(view.id.clone());
        let tree = sent!(page, "Accessibility.getFullAXTree", json!({}));
        let [x, y] = view.position;
        let [width, height] = view.size;
        lines.push_str(&format!(
            "- view {}, at {x},{y}, {width}x{height}\n",
            view.id
        ));
        lines.push_str(&outline(&tree, 1, &format!("{}:", view.id)));
    }
    Ok(Ok(lines))
}

fn carried_out<D: FnMut(&[String]) -> io::Result<Ran>>(
    tool: Browser,
    arguments: &Map<String, Value>,
    element: Option<u64>,
    page: &mut Page<'_, D>,
) -> io::Result<Result<Value, String>> {
    match tool {
        Browser::Snapshot => Ok(outline_of(page)?.map(|lines| said(true, lines))),
        Browser::Click if element.is_none() => {
            let Some(at) = arguments.get("at") else {
                return Ok(Err(
                    "browser_click takes the ref of an element, or a point `at`".to_string(),
                ));
            };
            let (button, count) = match clicked_with(arguments) {
                Ok(how) => how,
                Err(why) => return Ok(Err(why)),
            };
            let scale = match page.scale()? {
                Ok(scale) => scale,
                Err(why) => return Ok(Err(why)),
            };
            let (x, y) = match pair(arguments, "at") {
                Ok((x, y)) => (x / scale, y / scale),
                Err(why) => return Ok(Err(why)),
            };
            sent!(
                page,
                "Input.dispatchMouseEvent",
                json!({"type": "mouseMoved", "x": x, "y": y})
            );
            for click in 1..=count {
                for kind in ["mousePressed", "mouseReleased"] {
                    sent!(
                        page,
                        "Input.dispatchMouseEvent",
                        json!({"type": kind, "x": x, "y": y, "button": button, "buttons": held(button, kind), "clickCount": click})
                    );
                }
            }
            Ok(Ok(said(true, format!("clicked at {at}"))))
        }
        Browser::Drag => {
            let scale = match page.scale()? {
                Ok(scale) => scale,
                Err(why) => return Ok(Err(why)),
            };
            let ((x1, y1), (x2, y2)) = match (pair(arguments, "from"), pair(arguments, "to")) {
                (Ok(from), Ok(to)) => (
                    (from.0 / scale, from.1 / scale),
                    (to.0 / scale, to.1 / scale),
                ),
                (Err(why), _) | (_, Err(why)) => return Ok(Err(why)),
            };
            sent!(
                page,
                "Input.dispatchMouseEvent",
                json!({"type": "mouseMoved", "x": x1, "y": y1})
            );
            sent!(
                page,
                "Input.dispatchMouseEvent",
                json!({"type": "mousePressed", "x": x1, "y": y1, "button": "left", "buttons": 1, "clickCount": 1})
            );
            // In steps, so a page that follows the pointer sees it travel.
            for step in 1..=DRAG_STEPS {
                let along = f64::from(step) / f64::from(DRAG_STEPS);
                sent!(
                    page,
                    "Input.dispatchMouseEvent",
                    json!({"type": "mouseMoved", "x": x1 + (x2 - x1) * along, "y": y1 + (y2 - y1) * along, "button": "left", "buttons": 1})
                );
            }
            sent!(
                page,
                "Input.dispatchMouseEvent",
                json!({"type": "mouseReleased", "x": x2, "y": y2, "button": "left", "buttons": 0, "clickCount": 1})
            );
            Ok(Ok(said(true, "dragged".to_string())))
        }
        Browser::Scroll => {
            let scale = match page.scale()? {
                Ok(scale) => scale,
                Err(why) => return Ok(Err(why)),
            };
            let ((x, y), (dx, dy)) = match (pair(arguments, "at"), pair(arguments, "by")) {
                (Ok(at), Ok(by)) => ((at.0 / scale, at.1 / scale), (by.0 / scale, by.1 / scale)),
                (Err(why), _) | (_, Err(why)) => return Ok(Err(why)),
            };
            sent!(
                page,
                "Input.dispatchMouseEvent",
                json!({"type": "mouseWheel", "x": x, "y": y, "deltaX": dx, "deltaY": dy})
            );
            Ok(Ok(said(true, "scrolled".to_string())))
        }
        Browser::Click => {
            let Some(element) = element else {
                unreachable!("a click with no ref is a click at a point, above")
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
        Browser::ChooseFiles => {
            let cancel = match arguments.get("cancel") {
                None => false,
                Some(Value::Bool(cancel)) => *cancel,
                Some(other) => return Ok(Err(format!("cancel is true or false, not {other}"))),
            };
            let paths = match arguments.get("paths") {
                None => None,
                Some(Value::Array(paths)) => match paths
                    .iter()
                    .map(|path| path.as_str().filter(|path| path.starts_with('/')))
                    .collect::<Option<Vec<_>>>()
                {
                    Some(paths) => Some(paths),
                    None => return Ok(Err("paths are absolute paths, as strings".to_string())),
                },
                Some(other) => return Ok(Err(format!("paths is a list of paths, not {other}"))),
            };
            match (paths, cancel) {
                (Some(paths), false) => {
                    sent!(page, "Domicile.chooseFiles", json!({"files": paths}));
                    Ok(Ok(said(
                        true,
                        format!("gave the page {} path(s)", paths.len()),
                    )))
                }
                (None, true) => {
                    sent!(page, "Domicile.chooseFiles", json!({"cancel": true}));
                    Ok(Ok(said(true, "canceled the file chooser".to_string())))
                }
                _ => Ok(Err(
                    "browser_choose_files takes paths, or cancel: true".to_string()
                )),
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

/// How many moves a drag takes between its ends.
const DRAG_STEPS: u32 = 8;

/// Argument `button` and `count`: the button a click presses and how many
/// times.
fn clicked_with(arguments: &Map<String, Value>) -> Result<(&'static str, u32), String> {
    let button = match string(arguments, "button")?.as_deref() {
        None | Some("left") => "left",
        Some("right") => "right",
        Some("middle") => "middle",
        Some(other) => return Err(format!("button is left, right or middle, not {other}")),
    };
    let count = match arguments.get("count") {
        None => 1,
        Some(_) => match number(arguments, "count")? {
            1.0 => 1,
            2.0 => 2,
            other => return Err(format!("count is 1 or 2, not {other}")),
        },
    };
    Ok((button, count))
}

/// The buttons held during a `kind` of `button`, as CDP's bit mask: held
/// while pressed, none once released.
fn held(button: &str, kind: &str) -> u32 {
    match (kind, button) {
        ("mouseReleased", _) => 0,
        (_, "right") => 2,
        (_, "middle") => 4,
        _ => 1,
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

/// The view a tool acts in and the element argument `ref` names, if given.
/// A ref from a view, `<view>:<element>`, names its view; argument `view`
/// names one for a tool given no ref.
pub(super) fn aimed(
    arguments: &Map<String, Value>,
) -> Result<(Option<String>, Option<u64>), String> {
    let view = string(arguments, "view")?;
    let not_a_ref =
        |element: &Value| format!("ref is an element's ref from browser_snapshot, not {element}");
    let (in_view, element) = match arguments.get("ref") {
        None => (None, None),
        Some(Value::Number(element)) => (
            None,
            Some(
                element
                    .as_u64()
                    .ok_or_else(|| not_a_ref(&Value::Number(element.clone())))?,
            ),
        ),
        Some(Value::String(said)) => {
            let (in_view, element) = match said.split_once(':') {
                Some((in_view, element)) => (Some(in_view.to_string()), element),
                None => (None, said.as_str()),
            };
            let element = element
                .parse()
                .map_err(|_| not_a_ref(&Value::String(said.clone())))?;
            (in_view, Some(element))
        }
        Some(other) => return Err(not_a_ref(other)),
    };
    match (in_view, view) {
        (Some(in_view), Some(view)) if in_view != view => Err(format!(
            "ref {in_view}:{} is in view {in_view}, not view {view}",
            element.expect("a ref names its view")
        )),
        (Some(in_view), _) => Ok((Some(in_view), element)),
        (None, view) => Ok((view, element)),
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
const GROUPING: [&str; 4] = ["generic", "none", "presentation", "LineBreak"];

/// Accessibility.getFullAXTree's nodes as an outline indented from `depth`,
/// one element a line: its role, name, ref after `prefix`, value and states.
/// Ignored and unnamed grouping nodes give their place to their children, and
/// text that repeats its parent's name is left out, as are the text boxes
/// that split a text's name into lines. At most [`MOST`] elements, then a
/// line saying it was cut.
fn outline(tree: &Value, depth: usize, prefix: &str) -> String {
    let nodes: Vec<&Value> = tree["nodes"]
        .as_array()
        .map_or(Vec::new(), |nodes| nodes.iter().collect());
    let by_id: std::collections::HashMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| Some((node["nodeId"].as_str()?, *node)))
        .collect();
    let mut outline = Outline {
        lines: String::new(),
        listed: 0,
        cut: false,
    };
    if let Some(root) = nodes.first() {
        write_node(root, &by_id, depth, "", prefix, &mut outline);
    }
    if outline.cut {
        outline
            .lines
            .push_str(&format!("… cut at {MOST} elements\n"));
    }
    outline.lines
}

/// An outline as it is written.
struct Outline {
    lines: String,
    /// How many elements it lists.
    listed: usize,
    /// Whether it stopped at [`MOST`] with elements left.
    cut: bool,
}

fn write_node(
    node: &Value,
    by_id: &std::collections::HashMap<&str, &Value>,
    depth: usize,
    parent_name: &str,
    prefix: &str,
    outline: &mut Outline,
) {
    let role = node["role"]["value"].as_str().unwrap_or("");
    let name = node["name"]["value"].as_str().unwrap_or("");
    let ignored = node["ignored"].as_bool().unwrap_or(false);
    let shown = !ignored
        && role != "InlineTextBox"
        && !(name.is_empty() && GROUPING.contains(&role))
        && !(role == "StaticText" && (name.is_empty() || name == parent_name));
    if shown && outline.listed >= MOST {
        outline.cut = true;
        return;
    }
    let lines = &mut outline.lines;
    let (depth_below, name_below) = if shown {
        outline.listed += 1;
        lines.push_str(&"  ".repeat(depth));
        lines.push_str("- ");
        lines.push_str(role);
        if !name.is_empty() {
            lines.push_str(&format!(" {:?}", shortened(name)));
        }
        if let Some(element) = node["backendDOMNodeId"].as_u64() {
            lines.push_str(&format!(" [ref={prefix}{element}]"));
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
            write_node(child, by_id, depth_below, name_below, prefix, outline);
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
