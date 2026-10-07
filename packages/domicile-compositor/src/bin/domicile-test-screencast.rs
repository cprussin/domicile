//! An application and a shell for `scripts/e2e-a-screen-cast-through-the-portal.sh`
//! and `scripts/e2e-a-monitor-casts-through-the-portal.sh`.
//!
//!     domicile-test-screencast CHROME_SOCKET (--window TITLE | --monitor)
//!
//! Connects to the compositor as its shell, and calls the ScreenCast backend
//! on the session bus as an application's portal frontend would:
//!
//! 1. Starts a session that may be restored, picks the window titled `TITLE`
//!    or the first monitor in the source picker, and prints `node N`,
//!    `size W H` when the stream has a size, and `capturing ID`.
//! 2. Waits for a line on standard input, then for the capture to end on its
//!    own (the check's consumer left), and prints `ended`.
//! 3. Starts a second session with the first one's restore token, answering
//!    no picker, and prints `restored node N`.
//! 4. Closes that session, waits for its capture to end, and prints `closed`.
//!
//! Exits non-zero, saying why, at the first step that fails.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::ExitCode;
use std::thread;
use std::time::Duration;

use domicile_protocol::{
    Capturing, CastPick, CastSource, ChromeMessage, HostMessage, PortalAnswer, PortalKind,
    PortalRequest, ScreenCastDialog,
};
use domicile_test_chrome::Chrome;
use zbus::blocking::Connection;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};

const BUS_NAME: &str = "org.freedesktop.impl.portal.desktop.domicile";
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";
const INTERFACE: &str = "org.freedesktop.impl.portal.ScreenCast";
const APP: &str = "org.example.Recorder";

/// A portal method's response and results.
type Answered = (u32, HashMap<String, OwnedValue>);

/// What to pick in the source picker.
enum Wanted {
    /// The window with this title.
    Window(String),
    /// The first monitor.
    Monitor,
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let (socket, wanted) = match arguments.as_slice() {
        [socket, flag, title] if flag == "--window" => (socket, Wanted::Window(title.clone())),
        [socket, flag] if flag == "--monitor" => (socket, Wanted::Monitor),
        _ => {
            eprintln!("usage: domicile-test-screencast CHROME_SOCKET (--window TITLE | --monitor)");
            return ExitCode::from(2);
        }
    };
    match run(Path::new(socket), &wanted) {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("domicile-test-screencast: {why}");
            ExitCode::FAILURE
        }
    }
}

fn run(socket: &Path, wanted: &Wanted) -> Result<(), String> {
    let mut chrome =
        Chrome::connect(socket, Duration::from_secs(20)).map_err(|why| why.to_string())?;
    let bus = Connection::session().map_err(|why| format!("no session bus: {why}"))?;
    let selection = |restore: Option<Value<'static>>| {
        let mut options = vec![
            ("persist_mode", Value::from(2u32)),
            (
                "types",
                Value::from(match wanted {
                    Wanted::Window(_) => 2u32,
                    Wanted::Monitor => 1,
                }),
            ),
            // Embedded, so a monitor's stream draws the pointer where it is.
            ("cursor_mode", Value::from(2u32)),
        ];
        options.extend(restore.map(|restore| ("restore_data", restore)));
        options
    };

    let session = "/org/freedesktop/portal/desktop/session/1_1/first";
    select(&bus, session, selection(None))?;
    let starting = start(&bus, session);
    let (id, pick) = picker(&mut chrome, wanted)?;
    chrome
        .say(&ChromeMessage::AnswerPortalRequest {
            id,
            answer: PortalAnswer::ScreenCast {
                sources: vec![pick],
            },
        })
        .map_err(|why| why.to_string())?;
    let results = started(starting)?;
    let (node, size) = stream(&results)?;
    say(&format!("node {node}"));
    if let Some((width, height)) = size {
        say(&format!("size {width} {height}"));
    }
    let capture = capturing(&mut chrome, |capturing| !capturing.is_empty())?;
    say(&format!("capturing {capture}"));

    std::io::stdin()
        .lock()
        .lines()
        .next()
        .ok_or("standard input closed before the check said to go on")?
        .map_err(|why| why.to_string())?;
    capturing(&mut chrome, |capturing| capturing.is_empty())?;
    say("ended");

    let restore = results
        .get("restore_data")
        .ok_or("the first session handed out no restore token")?
        .try_clone()
        .map_err(|why| why.to_string())?;
    let session = "/org/freedesktop/portal/desktop/session/1_1/second";
    select(&bus, session, selection(Some(Value::from(restore))))?;
    let results = started(start(&bus, session))?;
    say(&format!("restored node {}", stream(&results)?.0));
    capturing(&mut chrome, |capturing| !capturing.is_empty())?;

    bus.call_method(
        Some(BUS_NAME),
        session,
        Some("org.freedesktop.impl.portal.Session"),
        "Close",
        &(),
    )
    .map_err(|why| format!("Close failed: {why}"))?;
    capturing(&mut chrome, |capturing| capturing.is_empty())?;
    say("closed");
    Ok(())
}

/// Create a session at `session` and select sources with `options`.
fn select(
    bus: &Connection,
    session: &str,
    options: Vec<(&str, Value<'static>)>,
) -> Result<(), String> {
    for (method, body) in [("CreateSession", Vec::new()), ("SelectSources", options)] {
        let (response, _) = call(
            bus,
            method,
            &(
                path("/org/freedesktop/portal/desktop/request/1_1/r")?,
                path(session)?,
                APP,
                owned(body)?,
            ),
        )?;
        if response != 0 {
            return Err(format!("{method} answered {response}"));
        }
    }
    Ok(())
}

/// Call `Start` on `session` from another thread.
fn start(bus: &Connection, session: &'static str) -> thread::JoinHandle<Result<Answered, String>> {
    let bus = bus.clone();
    thread::spawn(move || {
        call(
            &bus,
            "Start",
            &(
                path("/org/freedesktop/portal/desktop/request/1_1/s")?,
                path(session)?,
                APP,
                "",
                HashMap::<String, OwnedValue>::new(),
            ),
        )
    })
}

/// `Start`'s results, once it answered `0`.
fn started(
    starting: thread::JoinHandle<Result<Answered, String>>,
) -> Result<HashMap<String, OwnedValue>, String> {
    match starting.join().map_err(|_| "Start panicked")?? {
        (0, results) => Ok(results),
        (response, _) => Err(format!("Start answered {response}")),
    }
}

/// The source picker's request id and the pick of what `wanted` names.
fn picker(chrome: &mut Chrome, wanted: &Wanted) -> Result<(u32, CastPick), String> {
    loop {
        let (items, _) = next_push(chrome)?;
        let found = items.into_iter().find_map(|item| match item.kind {
            PortalKind::ScreenCast(dialog) => Some(
                picked(&dialog, wanted)
                    .map(|pick| (item.id, pick))
                    .ok_or_else(|| {
                        format!(
                            "the source picker offered nothing to pick: {:?}",
                            dialog.sources
                        )
                    }),
            ),
            // Only the source picker matters here.
            _ => None,
        });
        if let Some(found) = found {
            return found;
        }
    }
}

/// The source of `dialog` that `wanted` names.
fn picked(dialog: &ScreenCastDialog, wanted: &Wanted) -> Option<CastPick> {
    dialog
        .sources
        .iter()
        .find_map(|source| match (source, wanted) {
            (CastSource::Window { id, title, .. }, Wanted::Window(wanted)) if title == wanted => {
                Some(CastPick::Window { id: id.clone() })
            }
            (CastSource::Monitor { name, .. }, Wanted::Monitor) => {
                Some(CastPick::Monitor { name: name.clone() })
            }
            _ => None,
        })
}

/// The id of the first capture once the list of captures satisfies `wanted`.
fn capturing(chrome: &mut Chrome, wanted: impl Fn(&[Capturing]) -> bool) -> Result<u32, String> {
    loop {
        let (_, capturing) = next_push(chrome)?;
        if wanted(&capturing) {
            return Ok(capturing.first().map_or(0, |capture| capture.id));
        }
    }
}

/// The next portal state the compositor pushed, oldest first, so a state
/// already passed never matches.
fn next_push(chrome: &mut Chrome) -> Result<(Vec<PortalRequest>, Vec<Capturing>), String> {
    match chrome.wait_for(|message| matches!(message, HostMessage::PortalRequests { .. })) {
        Ok(HostMessage::PortalRequests {
            items, capturing, ..
        }) => Ok((items, capturing)),
        Ok(_) => unreachable!("matched above"),
        Err(why) => Err(format!("the portal state never came: {why}")),
    }
}

/// The first stream's PipeWire node, and its size if it has one. A window
/// the page has not placed has none.
fn stream(results: &HashMap<String, OwnedValue>) -> Result<(u32, Option<(i32, i32)>), String> {
    let streams: Vec<(u32, HashMap<String, OwnedValue>)> = results
        .get("streams")
        .ok_or("Start returned no streams")?
        .try_clone()
        .map_err(|why| why.to_string())?
        .try_into()
        .map_err(|why: zbus::zvariant::Error| why.to_string())?;
    let (node, properties) = streams
        .first()
        .ok_or("Start returned an empty list of streams")?;
    let size = properties
        .get("size")
        .map(|size| {
            size.try_clone()
                .map_err(|why| why.to_string())?
                .try_into()
                .map_err(|why: zbus::zvariant::Error| why.to_string())
        })
        .transpose()?;
    Ok((*node, size))
}

fn call<B: zbus::export::serde::Serialize + zbus::zvariant::DynamicType>(
    bus: &Connection,
    method: &str,
    body: &B,
) -> Result<(u32, HashMap<String, OwnedValue>), String> {
    bus.call_method(Some(BUS_NAME), OBJECT_PATH, Some(INTERFACE), method, body)
        .map_err(|why| format!("{method} failed: {why}"))?
        .body()
        .deserialize()
        .map_err(|why| format!("{method}'s reply: {why}"))
}

fn path(path: &str) -> Result<ObjectPath<'static>, String> {
    ObjectPath::try_from(path.to_string()).map_err(|why| why.to_string())
}

fn owned(options: Vec<(&str, Value<'static>)>) -> Result<HashMap<String, OwnedValue>, String> {
    options
        .into_iter()
        .map(|(name, value)| {
            OwnedValue::try_from(value)
                .map(|value| (name.to_string(), value))
                .map_err(|why| why.to_string())
        })
        .collect()
}

fn say(line: &str) {
    println!("{line}");
    std::io::stdout().flush().expect("standard output is open");
}
