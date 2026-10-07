//! `org.freedesktop.impl.portal.ScreenCast`: an application records windows.
//!
//! - `SelectSources` keeps the application's options on the session.
//! - `Start` asks the shell which windows to share, unless a restore token
//!   names windows that are open, and starts a [`Casting`] stream of each.
//! - The capture is listed for the shell's sharing indicator until it ends.
//!   Closing the session, the shell's stop, or every stream ending ends it.
//!
//! See `docs/architecture/PORTALS.md`.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::sync::{Arc, Mutex};

use domicile_host::cast_grants::{matched, Grants, Open, Persist, Shared};
use domicile_host::desktop_entries::DesktopEntries;
use domicile_protocol::{
    Captured, CapturingKind, CastPick, CastSource, PortalAnswer, PortalKind, ScreenCastDialog,
};
use tracing::{info, warn};
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::queue::{ask, Queue};
use super::session;
use crate::casting::{Candidate, Casting, CursorMode, Event, Source, StreamId};
use crate::reply::{reply, Replier};

/// The `org.freedesktop.impl.portal.ScreenCast` version implemented.
const INTERFACE_VERSION: u32 = 5;

/// `AvailableSourceTypes`: windows. Monitors join once the engine sends
/// their frames.
const WINDOW: u32 = 2;

/// `AvailableCursorModes`: hidden, embedded and metadata.
const CURSOR_MODES: u32 = 1 | 2 | 4;

/// The `restore_data` vendor and version this backend writes.
const VENDOR: &str = "domicile";
const RESTORE_VERSION: u32 = 1;

/// The `ScreenCast` backend object.
pub struct ScreenCast {
    queue: Arc<Queue>,
    casting: Casting,
    sessions: Arc<Mutex<HashMap<OwnedObjectPath, CastSession>>>,
    grants: Arc<Mutex<Grants>>,
    entries: Arc<Mutex<DesktopEntries>>,
}

/// One session, from `CreateSession` until it closes.
#[derive(Default)]
struct CastSession {
    /// The `SelectSources` options; `None` before it is called.
    selected: Option<Selected>,
    /// The streams `Start` started that have not ended.
    streams: Vec<StreamId>,
    /// The id the shell's indicator lists the capture under.
    capture: Option<u32>,
}

/// What an application asked for in `SelectSources`.
#[derive(Clone)]
struct Selected {
    multiple: bool,
    cursor: CursorMode,
    persist: Persist,
    /// The token the application came back with.
    restore: Option<String>,
}

impl ScreenCast {
    /// The backend over `queue`'s dialogs, casting through `casting`, keeping
    /// restore tokens in `grants` and naming windows from `entries`.
    pub fn new(
        queue: Arc<Queue>,
        casting: Casting,
        grants: Grants,
        entries: DesktopEntries,
    ) -> Self {
        ScreenCast {
            queue,
            casting,
            sessions: Arc::default(),
            grants: Arc::new(Mutex::new(grants)),
            entries: Arc::new(Mutex::new(entries)),
        }
    }
}

#[zbus::interface(name = "org.freedesktop.impl.portal.ScreenCast")]
impl ScreenCast {
    /// Open a session. Closing it stops its streams.
    async fn create_session(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        _handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let closing = Closing {
            queue: Arc::clone(&self.queue),
            casting: self.casting.clone(),
            sessions: Arc::clone(&self.sessions),
            handle: session_handle.clone(),
        };
        self.sessions
            .lock()
            .unwrap()
            .insert(session_handle.clone(), CastSession::default());
        match session::open(server, &session_handle, move || closing.close()).await {
            Ok(_) => (0, HashMap::new()),
            Err(why) => {
                warn!(%why, %session_handle, "a screen cast session could not be opened");
                self.sessions.lock().unwrap().remove(&session_handle);
                (2, HashMap::new())
            }
        }
    }

    /// Keep the application's options for `Start`. An option the spec does
    /// not allow answers `2`.
    async fn select_sources(
        &self,
        _handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        _app_id: String,
        options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let selected = match selected(&options) {
            Ok(selected) => selected,
            Err(why) => {
                warn!(%why, %session_handle, "a screen cast asked for what this desktop cannot do");
                return (2, HashMap::new());
            }
        };
        match self.sessions.lock().unwrap().get_mut(&session_handle) {
            Some(session) => {
                session.selected = Some(selected);
                (0, HashMap::new())
            }
            None => (2, HashMap::new()),
        }
    }

    /// Ask which windows to share, or recall them from a restore token, and
    /// start a stream of each.
    async fn start(
        &self,
        #[zbus(connection)] connection: &zbus::Connection,
        handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        _options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let Some(selected) = self
            .sessions
            .lock()
            .unwrap()
            .get(&session_handle)
            .and_then(|session| session.selected.clone())
        else {
            return (2, HashMap::new());
        };
        let Some(listed) = self.casting.list().await else {
            return (2, HashMap::new());
        };
        // Only windows until monitors are offered; see `AvailableSourceTypes`.
        let open: Vec<Candidate> = listed
            .into_iter()
            .filter(|candidate| matches!(candidate.source, Source::Window(_)))
            .collect();
        let picked = match self.recalled(&selected, &open) {
            Some(picked) => picked,
            None => {
                let kind = self.dialog(&selected, &open);
                match ask(
                    &self.queue,
                    connection.object_server(),
                    handle,
                    app_id.clone(),
                    &parent_window,
                    kind,
                )
                .await
                {
                    PortalAnswer::ScreenCast { sources } => {
                        match chosen(&sources, &open, &selected) {
                            Some(picked) => picked,
                            None => {
                                warn!(?sources, "the shell picked windows that cannot be cast");
                                return (2, HashMap::new());
                            }
                        }
                    }
                    PortalAnswer::Canceled => return (1, HashMap::new()),
                    _ => return (2, HashMap::new()),
                }
            }
        };
        let ending = Ending {
            queue: Arc::clone(&self.queue),
            casting: self.casting.clone(),
            sessions: Arc::clone(&self.sessions),
            connection: connection.clone(),
            handle: session_handle.clone(),
        };
        let Some(streams) = self.cast(&picked, selected.cursor, &ending).await else {
            return (2, HashMap::new());
        };
        let capture = self.queue.begin(
            app_id,
            CapturingKind::ScreenCast {
                sources: picked
                    .iter()
                    .map(|candidate| Captured::Window {
                        id: window_id(candidate).to_string(),
                        title: candidate.title.clone(),
                    })
                    .collect(),
            },
            {
                let casting = self.casting.clone();
                let streams: Vec<StreamId> = streams.iter().map(|(stream, _)| *stream).collect();
                move || {
                    for stream in streams {
                        casting.stop(stream);
                    }
                }
            },
        );
        if !ending.captured(capture) {
            return (2, HashMap::new());
        }
        let mut results = HashMap::from([(
            "streams".to_string(),
            owned(Value::from(
                streams
                    .iter()
                    .zip(&picked)
                    .map(|((_, node), candidate)| (*node, stream_properties(candidate)))
                    .collect::<Vec<_>>(),
            )),
        )]);
        if let Some(token) = self.remember(&selected, &picked) {
            results.insert(
                "persist_mode".to_string(),
                owned(Value::from(selected.persist.mode())),
            );
            results.insert(
                "restore_data".to_string(),
                owned(Value::from((VENDOR, RESTORE_VERSION, Value::from(token)))),
            );
        }
        (0, results)
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn available_source_types(&self) -> u32 {
        WINDOW
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn available_cursor_modes(&self) -> u32 {
        CURSOR_MODES
    }

    #[zbus(property(emits_changed_signal = "const"), name = "version")]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

impl ScreenCast {
    /// The windows the application's restore token names, if every one is
    /// open.
    fn recalled(&self, selected: &Selected, open: &[Candidate]) -> Option<Vec<Candidate>> {
        let token = selected.restore.as_deref()?;
        let grants = self.grants.lock().unwrap();
        let shared = grants.recall(token)?;
        let ids = matched(
            shared,
            &open
                .iter()
                .map(|candidate| Open {
                    id: window_id(candidate).to_string(),
                    app_id: candidate.app_id.clone(),
                    title: candidate.title.clone(),
                })
                .collect::<Vec<_>>(),
        )?;
        Some(
            ids.iter()
                .filter_map(|id| open.iter().find(|candidate| window_id(candidate) == id))
                .cloned()
                .collect(),
        )
    }

    /// The source picker for `open`, each window named by its desktop entry.
    fn dialog(&self, selected: &Selected, open: &[Candidate]) -> PortalKind {
        let mut entries = self.entries.lock().unwrap();
        PortalKind::ScreenCast(ScreenCastDialog {
            multiple: selected.multiple,
            sources: open
                .iter()
                .map(|candidate| {
                    let described = if candidate.app_id.is_empty() {
                        Default::default()
                    } else {
                        entries.describe(&candidate.app_id)
                    };
                    CastSource::Window {
                        id: window_id(candidate).to_string(),
                        title: candidate.title.clone(),
                        app_name: described.name,
                        icon: described.icon,
                    }
                })
                .collect(),
        })
    }

    /// Start a stream of each of `picked` on the session and wait for its
    /// node. `None`, with every stream stopped, when one cannot start.
    async fn cast(
        &self,
        picked: &[Candidate],
        cursor: CursorMode,
        ending: &Ending,
    ) -> Option<Vec<(StreamId, u32)>> {
        let started: Vec<_> = picked
            .iter()
            .map(|candidate| {
                let (ready, node) = reply();
                let stream = self
                    .casting
                    .start(candidate.source.clone(), cursor, |stream| {
                        ending.started(stream);
                        listener(stream, ready, ending.clone())
                    });
                (stream, node)
            })
            .collect();
        let mut streams = Vec::new();
        for (stream, node) in started {
            streams.push((stream, node.await));
        }
        if streams.iter().all(|(_, node)| node.is_some()) {
            Some(
                streams
                    .into_iter()
                    .filter_map(|(stream, node)| Some((stream, node?)))
                    .collect(),
            )
        } else {
            for (stream, _) in streams {
                self.casting.stop(stream);
            }
            None
        }
    }

    /// Keep the grant `selected.persist` asks for, returning its token.
    fn remember(&self, selected: &Selected, picked: &[Candidate]) -> Option<String> {
        let granted = self.grants.lock().unwrap().grant(
            selected.persist,
            selected.restore.as_deref(),
            picked
                .iter()
                .map(|candidate| Shared {
                    app_id: candidate.app_id.clone(),
                    title: candidate.title.clone(),
                })
                .collect(),
            fresh_token,
        );
        granted.unwrap_or_else(|why| {
            warn!(%why, "a screen cast grant could not be saved; the application will ask again");
            None
        })
    }
}

/// Ends a session the application closed: its streams stop and its capture
/// leaves the shell's list.
struct Closing {
    queue: Arc<Queue>,
    casting: Casting,
    sessions: Arc<Mutex<HashMap<OwnedObjectPath, CastSession>>>,
    handle: OwnedObjectPath,
}

impl Closing {
    fn close(self) {
        let Some(session) = self.sessions.lock().unwrap().remove(&self.handle) else {
            return;
        };
        for stream in session.streams {
            self.casting.stop(stream);
        }
        if let Some(capture) = session.capture {
            self.queue.end(capture);
        }
    }
}

/// Tracks a session's streams, and ends the session when its last stream
/// ends, whoever ended it.
#[derive(Clone)]
struct Ending {
    queue: Arc<Queue>,
    casting: Casting,
    sessions: Arc<Mutex<HashMap<OwnedObjectPath, CastSession>>>,
    connection: zbus::Connection,
    handle: OwnedObjectPath,
}

impl Ending {
    /// `stream` is starting on the session. Stopped at once when the session
    /// closed meanwhile.
    fn started(&self, stream: StreamId) {
        match self.sessions.lock().unwrap().get_mut(&self.handle) {
            Some(session) => session.streams.push(stream),
            None => self.casting.stop(stream),
        }
    }

    /// The session's streams are listed as `capture`. `false`, with the
    /// capture ended, when the session ended meanwhile.
    fn captured(&self, capture: u32) -> bool {
        let listed = match self.sessions.lock().unwrap().get_mut(&self.handle) {
            Some(session) => {
                session.capture = Some(capture);
                true
            }
            None => false,
        };
        if !listed {
            self.queue.end(capture);
        }
        listed
    }

    /// `stream` ended. Runs on the Wayland or PipeWire thread, so the session
    /// is closed on the bus's executor.
    fn ended(&self, stream: StreamId) {
        let capture = {
            let mut sessions = self.sessions.lock().unwrap();
            let Some(session) = sessions.get_mut(&self.handle) else {
                return;
            };
            if !session.streams.contains(&stream) {
                return;
            }
            session.streams.retain(|other| *other != stream);
            if !session.streams.is_empty() {
                return;
            }
            sessions
                .remove(&self.handle)
                .and_then(|session| session.capture)
        };
        if let Some(capture) = capture {
            self.queue.end(capture);
        }
        let connection = self.connection.clone();
        let handle = self.handle.clone();
        self.connection
            .executor()
            .spawn(
                async move {
                    if let Err(why) = session::end(connection.object_server(), &handle).await {
                        warn!(%why, %handle, "an application was not told its screen cast ended");
                    }
                },
                "end a screen cast session",
            )
            .detach();
    }
}

/// Stream `stream`'s listener: hands its node to `ready`, and tells `ending`
/// when it ends.
fn listener(stream: StreamId, ready: Replier<u32>, ending: Ending) -> crate::casting::Listener {
    let mut ready = Some(ready);
    Box::new(move |event| match event {
        Event::Ready { node } => {
            if let Some(ready) = ready.take() {
                ready.send(node);
            }
        }
        Event::Ended(why) => {
            info!(?why, handle = %ending.handle, "a screen cast stream ended");
            // Dropping `ready` unsent fails a stream that never started.
            ready = None;
            ending.ended(stream);
        }
    })
}

/// The `SelectSources` options, read.
fn selected(options: &HashMap<String, OwnedValue>) -> Result<Selected, String> {
    let number = |name: &str| -> Result<Option<u32>, String> {
        options
            .get(name)
            .map(|value| u32::try_from(value).map_err(|_| format!("{name} is not a u32")))
            .transpose()
    };
    // The spec's default is a monitor.
    let types = number("types")?.unwrap_or(1);
    if types & WINDOW == 0 {
        return Err(format!("source types {types} include no window"));
    }
    let cursor = match number("cursor_mode")?.unwrap_or(1) {
        1 => CursorMode::Hidden,
        2 => CursorMode::Embedded,
        4 => CursorMode::Metadata,
        mode => return Err(format!("cursor mode {mode}")),
    };
    let persist = number("persist_mode")?.unwrap_or(0);
    let persist = Persist::from_mode(persist).ok_or_else(|| format!("persist mode {persist}"))?;
    let multiple = options
        .get("multiple")
        .map(|value| bool::try_from(value).map_err(|_| "multiple is not a boolean".to_string()))
        .transpose()?
        .unwrap_or(false);
    Ok(Selected {
        multiple,
        cursor,
        persist,
        restore: options.get("restore_data").and_then(restore_token),
    })
}

/// The token in `restore_data` this backend wrote, or `None` for another
/// backend's.
fn restore_token(data: &OwnedValue) -> Option<String> {
    let Value::Structure(data) = &**data else {
        return None;
    };
    match data.fields() {
        [Value::Str(vendor), Value::U32(RESTORE_VERSION), Value::Value(token)]
            if vendor.as_str() == VENDOR =>
        {
            match &**token {
                Value::Str(token) => Some(token.to_string()),
                _ => None,
            }
        }
        _ => None,
    }
}

/// The windows the shell picked, or `None` for one not open or more than
/// one when the application asked for one.
fn chosen(picks: &[CastPick], open: &[Candidate], selected: &Selected) -> Option<Vec<Candidate>> {
    if picks.is_empty() || (picks.len() > 1 && !selected.multiple) {
        return None;
    }
    picks
        .iter()
        .map(|CastPick::Window { id }| {
            open.iter()
                .find(|candidate| window_id(candidate) == id)
                .cloned()
        })
        .collect()
}

/// A stream's properties for `Start`'s results.
fn stream_properties(candidate: &Candidate) -> HashMap<String, OwnedValue> {
    let mut properties = HashMap::from([
        ("source_type".to_string(), owned(Value::from(WINDOW))),
        ("id".to_string(), owned(Value::from(window_id(candidate)))),
    ]);
    if let Some(bounds) = candidate.bounds {
        properties.insert("position".to_string(), owned(Value::from(bounds.position)));
        properties.insert("size".to_string(), owned(Value::from(bounds.size)));
    }
    properties
}

/// A listed window's host app id. `start` keeps only windows.
fn window_id(candidate: &Candidate) -> &str {
    match &candidate.source {
        Source::Window(id) => id,
        Source::Monitor(_) | Source::Region(_) => unreachable!("only windows are offered"),
    }
}

fn owned(value: Value<'_>) -> OwnedValue {
    OwnedValue::try_from(value).expect("a value with no file descriptors is ownable")
}

/// A new restore token: 128 random bits as hex.
fn fresh_token() -> String {
    let mut bytes = [0u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut bytes))
        .expect("/dev/urandom is readable");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    use std::thread;
    use std::time::Duration;

    use domicile_protocol::{
        Captured, Capturing, CapturingKind, CastPick, CastSource, PortalAnswer, PortalKind,
        PortalRequest, ScreenCastDialog,
    };
    use smithay::reexports::calloop::channel::{channel as calloop_channel, Event as Heard};
    use smithay::reexports::calloop::EventLoop;
    use zbus::zvariant::{ObjectPath, OwnedValue, Value};

    use crate::casting::{Candidate, Ended, Event, Region, Request, Source};
    use crate::portals::socket_pair::connected;
    use crate::portals::OBJECT_PATH;

    const INTERFACE: &str = "org.freedesktop.impl.portal.ScreenCast";
    const SESSION: &str = "/org/freedesktop/portal/desktop/session/1_7/s";

    /// What the backend published, and the casts it started and stopped.
    struct Served {
        client: zbus::blocking::Connection,
        queue: Arc<Queue>,
        published: Receiver<(Vec<PortalRequest>, Vec<Capturing>)>,
        casts: Receiver<String>,
        _server: zbus::blocking::Connection,
    }

    /// The backend, over windows `app-3` ("Notes", `org.gnome.TextEditor`)
    /// and `app-4` ("Todo"), with grants kept in `grants`.
    fn served(grants: Grants) -> Served {
        let queue = Arc::<Queue>::default();
        let (publish, published) = channel();
        queue.listen(
            move |items, capturing| {
                let _ = publish.send((items, capturing));
            },
            || true,
            |_| None,
        );
        let (casting, casts) = wayland_thread();
        let backend = ScreenCast::new(
            Arc::clone(&queue),
            casting,
            grants,
            DesktopEntries::new(Vec::new()),
        );
        let (server, client) = connected(|builder| {
            builder
                .serve_at(OBJECT_PATH, backend)
                .expect("the interface registered")
        });
        Served {
            client,
            queue,
            published,
            casts,
            _server: server,
        }
    }

    /// A stand-in for the Wayland thread: lists two windows, makes each
    /// stream ready at once, and reports what it starts and stops.
    fn wayland_thread() -> (Casting, Receiver<String>) {
        let (requests, heard) = calloop_channel::<Request>();
        let (told, casts) = channel();
        thread::spawn(move || {
            let mut event_loop = EventLoop::<bool>::try_new().expect("a loop");
            let mut listeners = HashMap::new();
            event_loop
                .handle()
                .insert_source(heard, move |event, _, open| match event {
                    Heard::Msg(Request::List { reply }) => reply.send(windows()),
                    Heard::Msg(Request::Start {
                        stream,
                        source: Source::Window(id),
                        mut listener,
                        ..
                    }) => {
                        let _ = told.send(format!("start {id}"));
                        listener(Event::Ready { node: 42 });
                        listeners.insert(stream, listener);
                    }
                    Heard::Msg(Request::Start { mut listener, .. }) => {
                        listener(Event::Ended(Ended::SourceGone));
                    }
                    Heard::Msg(Request::Stop { stream }) => {
                        let _ = told.send("stop".to_string());
                        if let Some(mut listener) = listeners.remove(&stream) {
                            listener(Event::Ended(Ended::Stopped));
                        }
                    }
                    Heard::Msg(Request::Shoot { developed, .. }) => {
                        developed(Err("no desk here".into()));
                    }
                    Heard::Closed => *open = false,
                })
                .expect("a channel source");
            let mut open = true;
            while open {
                event_loop
                    .dispatch(Duration::from_millis(50), &mut open)
                    .expect("dispatched");
            }
        });
        (Casting::new(requests), casts)
    }

    fn windows() -> Vec<Candidate> {
        vec![
            Candidate {
                source: Source::Window("app-3".into()),
                title: "Notes".into(),
                app_id: "org.gnome.TextEditor".into(),
                bounds: Some(Region {
                    position: (10, 20),
                    size: (640, 480),
                }),
            },
            Candidate {
                source: Source::Window("app-4".into()),
                title: "Todo".into(),
                app_id: String::new(),
                bounds: None,
            },
        ]
    }

    fn options(sent: Vec<(&str, Value<'static>)>) -> HashMap<String, OwnedValue> {
        sent.into_iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    OwnedValue::try_from(value).expect("an ownable value"),
                )
            })
            .collect()
    }

    fn path(path: &str) -> ObjectPath<'static> {
        ObjectPath::try_from(path.to_string()).expect("a path")
    }

    /// Call `method` with the request handle, `SESSION` and `rest`.
    fn call<B: zbus::export::serde::Serialize + zbus::zvariant::DynamicType>(
        client: &zbus::blocking::Connection,
        method: &str,
        body: &B,
    ) -> (u32, HashMap<String, OwnedValue>) {
        client
            .call_method(None::<&str>, OBJECT_PATH, Some(INTERFACE), method, body)
            .unwrap_or_else(|why| panic!("{method} failed: {why}"))
            .body()
            .deserialize()
            .expect("a response and results")
    }

    /// Create a session and select windows, with `select` besides.
    fn select(client: &zbus::blocking::Connection, mut select: Vec<(&str, Value<'static>)>) {
        select.push(("types", Value::from(2u32)));
        let (response, _) = call(
            client,
            "CreateSession",
            &(
                path("/org/freedesktop/portal/desktop/request/1_7/a"),
                path(SESSION),
                "us.zoom.Zoom",
                options(vec![]),
            ),
        );
        assert_eq!(response, 0, "the session opened");
        let (response, _) = call(
            client,
            "SelectSources",
            &(
                path("/org/freedesktop/portal/desktop/request/1_7/b"),
                path(SESSION),
                "us.zoom.Zoom",
                options(select),
            ),
        );
        assert_eq!(response, 0, "the sources were selected");
    }

    /// Call `Start` from another thread.
    fn start(
        client: &zbus::blocking::Connection,
    ) -> thread::JoinHandle<(u32, HashMap<String, OwnedValue>)> {
        let client = client.clone();
        thread::spawn(move || {
            call(
                &client,
                "Start",
                &(
                    path("/org/freedesktop/portal/desktop/request/1_7/c"),
                    path(SESSION),
                    "us.zoom.Zoom",
                    "",
                    options(vec![]),
                ),
            )
        })
    }

    #[track_caller]
    fn next(
        published: &Receiver<(Vec<PortalRequest>, Vec<Capturing>)>,
    ) -> (Vec<PortalRequest>, Vec<Capturing>) {
        published
            .recv_timeout(Duration::from_secs(10))
            .expect("the queue published")
    }

    /// Pick `app-3` in the dialog `Start` puts up.
    fn pick_notes(served: &Served) -> (u32, HashMap<String, OwnedValue>) {
        let starting = start(&served.client);
        let (items, _) = next(&served.published);
        served.queue.answer(
            items[0].id,
            PortalAnswer::ScreenCast {
                sources: vec![CastPick::Window { id: "app-3".into() }],
            },
        );
        starting.join().expect("Start returned")
    }

    #[track_caller]
    fn heard(casts: &Receiver<String>) -> String {
        casts
            .recv_timeout(Duration::from_secs(10))
            .expect("the Wayland thread heard")
    }

    #[test]
    fn the_shell_picks_from_the_open_windows() {
        let served = served(Grants::default());
        select(&served.client, vec![]);
        let starting = start(&served.client);

        let (items, _) = next(&served.published);

        assert_eq!(
            items,
            [PortalRequest {
                id: items[0].id,
                app_id: "us.zoom.Zoom".into(),
                parent_app_id: None,
                kind: PortalKind::ScreenCast(ScreenCastDialog {
                    multiple: false,
                    sources: vec![
                        CastSource::Window {
                            id: "app-3".into(),
                            title: "Notes".into(),
                            app_name: None,
                            icon: None,
                        },
                        CastSource::Window {
                            id: "app-4".into(),
                            title: "Todo".into(),
                            app_name: None,
                            icon: None,
                        },
                    ],
                }),
            }]
        );
        served.queue.answer(items[0].id, PortalAnswer::Canceled);
        assert_eq!(starting.join().expect("Start returned").0, 1);
    }

    #[test]
    fn a_picked_window_is_cast_and_its_node_handed_back() {
        let served = served(Grants::default());
        select(&served.client, vec![]);

        let (response, results) = pick_notes(&served);

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), "start app-3");
        let streams: Vec<(u32, HashMap<String, OwnedValue>)> = results
            .get("streams")
            .expect("streams")
            .try_clone()
            .expect("cloned")
            .try_into()
            .expect("a(ua{sv})");
        let (node, properties) = &streams[0];
        assert_eq!(*node, 42);
        let read = |name: &str| {
            properties
                .get(name)
                .expect(name)
                .try_clone()
                .expect("cloned")
        };
        assert_eq!(u32::try_from(read("source_type")), Ok(2));
        assert_eq!(<(i32, i32)>::try_from(read("size")), Ok((640, 480)));
        assert_eq!(<(i32, i32)>::try_from(read("position")), Ok((10, 20)));
        assert!(!results.contains_key("restore_data"), "persist_mode 0");
        assert_eq!(
            served
                .published
                .try_iter()
                .last()
                .map(|(_, capturing)| capturing),
            Some(vec![Capturing {
                id: 2,
                app_id: "us.zoom.Zoom".into(),
                kind: CapturingKind::ScreenCast {
                    sources: vec![Captured::Window {
                        id: "app-3".into(),
                        title: "Notes".into(),
                    }],
                },
            }])
        );
    }

    #[test]
    fn closing_the_session_stops_its_streams() {
        let served = served(Grants::default());
        select(&served.client, vec![]);
        pick_notes(&served);
        heard(&served.casts);

        served
            .client
            .call_method(
                None::<&str>,
                SESSION,
                Some("org.freedesktop.impl.portal.Session"),
                "Close",
                &(),
            )
            .expect("Close answered");

        assert_eq!(heard(&served.casts), "stop");
        assert_eq!(next(&served.published).1, []);
    }

    #[test]
    fn the_shell_s_stop_ends_the_session() {
        let served = served(Grants::default());
        select(&served.client, vec![]);
        pick_notes(&served);
        heard(&served.casts);
        let capture = served.published.try_iter().last().expect("published").1[0].id;
        let mut messages = zbus::blocking::MessageIterator::from(&served.client);

        served.queue.answer(capture, PortalAnswer::Stop);

        assert_eq!(heard(&served.casts), "stop");
        assert!(
            messages.any(|message| {
                message
                    .expect("a message")
                    .header()
                    .member()
                    .map(|m| m.as_str())
                    == Some("Closed")
            }),
            "the application heard its session close"
        );
    }

    #[test]
    fn a_restore_token_shares_the_same_window_without_asking() {
        let directory = tempfile::tempdir().expect("a directory");
        let grants = Grants::load(directory.path().join("grants.json")).expect("loaded");
        let served = served(grants);
        select(&served.client, vec![("persist_mode", Value::from(2u32))]);
        let (_, results) = pick_notes(&served);
        heard(&served.casts);
        assert_eq!(
            results
                .get("persist_mode")
                .map(|mode| u32::try_from(mode.try_clone().expect("cloned"))),
            Some(Ok(2))
        );
        let restore = results
            .get("restore_data")
            .expect("a token")
            .try_clone()
            .expect("cloned");
        served
            .client
            .call_method(
                None::<&str>,
                SESSION,
                Some("org.freedesktop.impl.portal.Session"),
                "Close",
                &(),
            )
            .expect("Close answered");
        heard(&served.casts);

        select(
            &served.client,
            vec![
                ("persist_mode", Value::from(2u32)),
                ("restore_data", Value::from(restore)),
            ],
        );
        let (response, _) = start(&served.client).join().expect("Start returned");

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), "start app-3");
        assert!(
            served
                .published
                .try_iter()
                .all(|(items, _)| items.is_empty()),
            "no dialog was shown"
        );
    }

    #[test]
    fn options_this_backend_cannot_meet_are_refused() {
        let windows_and = |option: &'static str, value: u32| {
            selected(&options(vec![
                ("types", Value::from(2u32)),
                (option, Value::from(value)),
            ]))
        };

        assert!(windows_and("cursor_mode", 8).is_err());
        assert!(windows_and("persist_mode", 3).is_err());
        assert!(windows_and("cursor_mode", 4).is_ok());
        assert!(selected(&options(vec![])).is_err(), "a monitor, by default");
        assert!(selected(&options(vec![("types", Value::from(3u32))])).is_ok());
    }

    #[test]
    fn the_shell_may_pick_only_as_many_windows_as_were_asked_for() {
        let one = selected(&options(vec![("types", Value::from(2u32))])).expect("windows");
        let picks = |ids: &[&str]| -> Vec<CastPick> {
            ids.iter()
                .map(|id| CastPick::Window { id: id.to_string() })
                .collect()
        };

        assert!(chosen(&picks(&["app-3", "app-4"]), &windows(), &one).is_none());
        assert!(
            chosen(&picks(&["app-9"]), &windows(), &one).is_none(),
            "not open"
        );
        assert!(chosen(&picks(&[]), &windows(), &one).is_none());
        assert_eq!(
            chosen(&picks(&["app-4"]), &windows(), &one),
            Some(vec![windows()[1].clone()])
        );
    }

    #[test]
    fn windows_and_every_cursor_mode_are_offered() {
        let served = served(Grants::default());
        let property = |name: &str| -> u32 {
            served
                .client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.DBus.Properties"),
                    "Get",
                    &(INTERFACE, name),
                )
                .expect("Get answered")
                .body()
                .deserialize::<OwnedValue>()
                .expect("a variant")
                .try_into()
                .expect("a u32")
        };

        assert_eq!(property("AvailableSourceTypes"), 2);
        assert_eq!(property("AvailableCursorModes"), 7);
        assert_eq!(property("version"), 5);
    }
}
