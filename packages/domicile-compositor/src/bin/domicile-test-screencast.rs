//! An application and a shell for `scripts/e2e-a-screen-cast-through-the-portal.sh`.
//!
//!     domicile-test-screencast CHROME_SOCKET TITLE
//!
//! Connects to the compositor as its shell, and calls the ScreenCast backend
//! on the session bus as an application's portal frontend would:
//!
//! 1. Starts a session that may be restored, picks the window titled `TITLE`
//!    in the source picker, and prints `node N` and `capturing ID`.
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
    PortalRequest,
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

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [socket, title] = arguments.as_slice() else {
        eprintln!("usage: domicile-test-screencast CHROME_SOCKET TITLE");
        return ExitCode::from(2);
    };
    match run(Path::new(socket), title) {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("domicile-test-screencast: {why}");
            ExitCode::FAILURE
        }
    }
}

fn run(socket: &Path, title: &str) -> Result<(), String> {
    let mut chrome =
        Chrome::connect(socket, Duration::from_secs(20)).map_err(|why| why.to_string())?;
    let bus = Connection::session().map_err(|why| format!("no session bus: {why}"))?;

    let session = "/org/freedesktop/portal/desktop/session/1_1/first";
    select(&bus, session, vec![("persist_mode", Value::from(2u32))])?;
    let starting = start(&bus, session);
    let (id, window) = picker(&mut chrome, title)?;
    chrome
        .say(&ChromeMessage::AnswerPortalRequest {
            id,
            answer: PortalAnswer::ScreenCast {
                sources: vec![CastPick::Window { id: window }],
            },
        })
        .map_err(|why| why.to_string())?;
    let results = started(starting)?;
    say(&format!("node {}", node(&results)?));
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
    select(
        &bus,
        session,
        vec![
            ("persist_mode", Value::from(2u32)),
            ("restore_data", Value::from(restore)),
        ],
    )?;
    let results = started(start(&bus, session))?;
    say(&format!("restored node {}", node(&results)?));
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

/// Create a session at `session` and select windows, with `options` besides.
fn select(
    bus: &Connection,
    session: &str,
    mut options: Vec<(&str, Value<'static>)>,
) -> Result<(), String> {
    options.push(("types", Value::from(2u32)));
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

/// The source picker's request id and the id of the window titled `title`.
fn picker(chrome: &mut Chrome, title: &str) -> Result<(u32, String), String> {
    loop {
        let (items, _) = next_push(chrome)?;
        let found = items.into_iter().find_map(|item| match item.kind {
            PortalKind::ScreenCast(dialog) => Some(
                dialog
                    .sources
                    .iter()
                    .find_map(|source| {
                        let CastSource::Window {
                            id, title: named, ..
                        } = source;
                        (named == title).then(|| (item.id, id.clone()))
                    })
                    .ok_or_else(|| {
                        format!(
                            "the source picker offered no window titled {title:?}: {:?}",
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

/// The first stream's PipeWire node.
fn node(results: &HashMap<String, OwnedValue>) -> Result<u32, String> {
    let streams: Vec<(u32, HashMap<String, OwnedValue>)> = results
        .get("streams")
        .ok_or("Start returned no streams")?
        .try_clone()
        .map_err(|why| why.to_string())?
        .try_into()
        .map_err(|why: zbus::zvariant::Error| why.to_string())?;
    streams
        .first()
        .map(|(node, _)| *node)
        .ok_or_else(|| "Start returned an empty list of streams".to_string())
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
