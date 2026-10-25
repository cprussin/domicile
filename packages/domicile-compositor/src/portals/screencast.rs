//! `org.freedesktop.impl.portal.ScreenCast`: an application records windows,
//! monitors or regions of the desktop.
//!
//! - `SelectSources` keeps the application's options on the session.
//! - `Start` asks the shell what to share, of the source types the
//!   application asked for, unless a restore token names sources that are
//!   there, and starts a [`Casting`] stream of each. The picker previews the
//!   sources on a frame of the desk, and offers browser windows from the
//!   engine's own list when windows were asked for.
//! - The capture is listed for the shell's sharing indicator until it ends.
//!   Closing the session, the shell's stop, or every stream ending ends it.
//!
//! See `docs/PORTALS.md`.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::sync::{Arc, Mutex};

use domicile_host::cast_grants::{
    matched, mostly_on, Grants, Open, Persist, Placed, Restored, Shared,
};
use domicile_protocol::{
    Captured, CapturedMonitor, CapturingKind, CastPick, CastSource, FrozenDesk, PortalAnswer,
    PortalKind, ScreenCastDialog,
};
use tracing::{info, warn};
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::queue::{ask, Queue};
use super::screenshot::{frozen, Shoot};
use super::session;
use crate::casting::{
    self, Candidate, Casting, CursorMode, Event, Heard, Region, Source, StreamId,
};
use crate::reply::{reply, Replier};

/// The `org.freedesktop.impl.portal.ScreenCast` version implemented.
const INTERFACE_VERSION: u32 = 5;

/// The source types: a monitor, a window, and a region (`VIRTUAL`).
const MONITOR: u32 = 1;
const WINDOW: u32 = 2;
const VIRTUAL: u32 = 4;

/// The types an application may ask for to be offered a region. A region is
/// part of a monitor, so asking for monitors is asking for regions too.
const REGION_TYPES: u32 = MONITOR | VIRTUAL;

/// `AvailableSourceTypes`: every type.
const SOURCE_TYPES: u32 = MONITOR | WINDOW | VIRTUAL;

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
    /// Takes the frame of the desk the picker previews sources on.
    shoot: Shoot,
    picks: Picks,
}

/// What each running stream's node shows, for [`CastPicks`].
type Picks = Arc<Mutex<HashMap<u32, Pick>>>;

/// What a stream's node shows.
struct Pick {
    stream: StreamId,
    source_type: u32,
    /// The engine's id of the browser window it shows; empty for any other
    /// source.
    browser_window: String,
    /// Its sound node's name, or empty when it has none.
    sound: String,
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
    /// The source types asked for.
    types: u32,
    multiple: bool,
    cursor: CursorMode,
    persist: Persist,
    /// The token the application came back with.
    restore: Option<String>,
}

impl ScreenCast {
    /// The backend over `queue`'s dialogs, casting through `casting`,
    /// keeping restore tokens in `grants`, and previewing on what `shoot`
    /// takes.
    pub fn new(queue: Arc<Queue>, casting: Casting, grants: Grants, shoot: Shoot) -> Self {
        ScreenCast {
            queue,
            casting,
            sessions: Arc::default(),
            grants: Arc::new(Mutex::new(grants)),
            shoot,
            picks: Arc::default(),
        }
    }

    /// The `org.domicile.ScreenCast` object, which says what a stream's node
    /// shows.
    pub fn picks(&self) -> CastPicks {
        CastPicks {
            picks: Arc::clone(&self.picks),
        }
    }
}

/// Says what a running stream's node shows. The engine asks it for a page's
/// `getDisplayMedia()`, which webrtc's portal capturer gives the node alone:
/// the answer names the display surface, a browser window to capture as a
/// tab, and the sound node (see `crate::casting::audio`). Start's results
/// carry none of the last two.
pub struct CastPicks {
    picks: Picks,
}

#[zbus::interface(name = "org.domicile.ScreenCast")]
impl CastPicks {
    /// The source type, browser window and sound node name of node `node`'s
    /// stream. The browser window is empty for any other source; the sound
    /// is empty when the stream carries none.
    fn pick(&self, node: u32) -> zbus::fdo::Result<(u32, String, String)> {
        self.picks
            .lock()
            .unwrap()
            .get(&node)
            .map(|pick| {
                (
                    pick.source_type,
                    pick.browser_window.clone(),
                    pick.sound.clone(),
                )
            })
            .ok_or_else(|| zbus::fdo::Error::UnknownObject(format!("no stream at node {node}")))
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

    /// Ask what to share, or recall it from a restore token, and start a
    /// stream of each.
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
        let monitors = placed(&listed);
        let screens: Vec<Candidate> = listed
            .iter()
            .filter(|candidate| matches!(candidate.source, Source::Monitor(_)))
            .cloned()
            .collect();
        let open: Vec<Candidate> = listed
            .into_iter()
            .filter(|candidate| asked_for(&selected, &candidate.source))
            .collect();
        let picked = match self.recalled(&selected, &open, &monitors) {
            Some(picked) => picked,
            None => {
                let kind = self.dialog(&selected, &open, self.preview().await);
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
                                warn!(?sources, "the shell picked sources that cannot be cast");
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
            picks: Arc::clone(&self.picks),
            connection: connection.clone(),
            handle: session_handle.clone(),
        };
        let Some(streams) = self.cast(&picked, selected.cursor, &ending).await else {
            return (2, HashMap::new());
        };
        {
            let mut picks = self.picks.lock().unwrap();
            for ((stream, node), candidate) in streams.iter().zip(&picked) {
                picks.insert(*node, pick(*stream, candidate));
            }
        }
        let capture = self.queue.begin(
            app_id,
            CapturingKind::ScreenCast {
                sources: picked
                    .iter()
                    .map(|candidate| captured(candidate, &screens))
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
        if let Some(token) = self.remember(&selected, &picked, &monitors) {
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
        SOURCE_TYPES
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
    /// The sources the application's restore token names, if every one is
    /// there and of a type it asked for. `open` is what it may pick, and
    /// `monitors` every monitor, which a region is kept on.
    fn recalled(
        &self,
        selected: &Selected,
        open: &[Candidate],
        monitors: &[Placed],
    ) -> Option<Vec<Candidate>> {
        let token = selected.restore.as_deref()?;
        let grants = self.grants.lock().unwrap();
        let shared = grants.recall(token)?;
        let there: Vec<Open> = open
            .iter()
            .filter_map(|candidate| match &candidate.source {
                Source::Window(id) => Some(Open::Window {
                    id: id.clone(),
                    app_id: candidate.app_id.clone(),
                    title: candidate.title.clone(),
                }),
                Source::BrowserWindow(_) | Source::Monitor(_) | Source::Region(_) => None,
            })
            .chain(monitors.iter().cloned().map(Open::Monitor))
            .collect();
        matched(shared, &there)?
            .into_iter()
            .map(|restored| {
                let (source, part) = match restored {
                    Restored::Window { id, part } => (Source::Window(id), part),
                    Restored::Monitor(name) => (Source::Monitor(name), None),
                    Restored::BrowserWindow { id, title, part } => {
                        return asked_for(selected, &Source::BrowserWindow(id.clone())).then(
                            || Candidate {
                                part,
                                ..browser_window(id, title)
                            },
                        );
                    }
                    Restored::Region { position, size } => {
                        return asked_for(selected, &Source::Region(Region { position, size }))
                            .then(|| region(position, size));
                    }
                };
                open.iter()
                    .find(|candidate| candidate.source == source)
                    .map(|candidate| Candidate {
                        part,
                        ..candidate.clone()
                    })
            })
            .collect()
    }

    /// The frame of the desk the picker previews on. The picker draws
    /// icons in its place when the desk cannot be shot.
    async fn preview(&self) -> Option<FrozenDesk> {
        match (self.shoot)().await {
            Ok(desk) => Some(frozen(&desk)),
            Err(why) => {
                warn!(%why, "the desk could not be shot to preview a screen cast's sources");
                None
            }
        }
    }

    /// The source picker for `open`, previewed on `desk`.
    fn dialog(
        &self,
        selected: &Selected,
        open: &[Candidate],
        desk: Option<FrozenDesk>,
    ) -> PortalKind {
        PortalKind::ScreenCast(ScreenCastDialog {
            multiple: selected.multiple,
            sources: open
                .iter()
                .map(|candidate| match &candidate.source {
                    Source::Window(id) => CastSource::Window {
                        id: id.clone(),
                        title: candidate.title.clone(),
                        app_id: candidate.app_id.clone(),
                    },
                    Source::Monitor(name) => CastSource::Monitor {
                        name: name.clone(),
                        description: candidate.title.clone(),
                        size: candidate.bounds.expect("a monitor has bounds").size,
                    },
                    Source::BrowserWindow(_) | Source::Region(_) => {
                        unreachable!(
                            "browser windows are the engine's to list, and regions are drawn"
                        )
                    }
                })
                .collect(),
            region: selected.types & REGION_TYPES != 0,
            browser_windows: selected.types & WINDOW != 0,
            desk,
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
                let stream = self.casting.start(
                    candidate.source.clone(),
                    candidate.part,
                    cursor,
                    |stream| {
                        ending.started(stream);
                        listener(stream, ready, ending.clone())
                    },
                );
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

    /// Keep the grant `selected.persist` asks for, returning its token. A
    /// region is kept on the monitor of `monitors` it is mostly on.
    fn remember(
        &self,
        selected: &Selected,
        picked: &[Candidate],
        monitors: &[Placed],
    ) -> Option<String> {
        let Some(shared) = picked
            .iter()
            .map(|candidate| match &candidate.source {
                // A part is picked from a frame, which a restart does not
                // keep.
                _ if candidate.part.is_some() && selected.persist == Persist::Saved => None,
                Source::Window(_) => Some(Shared::Window {
                    app_id: candidate.app_id.clone(),
                    title: candidate.title.clone(),
                    part: candidate.part,
                }),
                Source::Monitor(name) => Some(Shared::Monitor { name: name.clone() }),
                Source::Region(region) => Shared::region(region.position, region.size, monitors),
                // The engine's ids start over with it.
                Source::BrowserWindow(id) => {
                    (selected.persist != Persist::Saved).then(|| Shared::BrowserWindow {
                        id: id.clone(),
                        title: candidate.title.clone(),
                        part: candidate.part,
                    })
                }
            })
            .collect::<Option<Vec<_>>>()
        else {
            warn!(
                "a screen cast region left every monitor, or a browser window was to be kept \
                 past a restart; the application will ask again"
            );
            return None;
        };
        let granted = self.grants.lock().unwrap().grant(
            selected.persist,
            selected.restore.as_deref(),
            shared,
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
    picks: Picks,
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
        self.picks
            .lock()
            .unwrap()
            .retain(|_, pick| pick.stream != stream);
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
    let types = number("types")?.unwrap_or(MONITOR);
    if types == 0 || types & !SOURCE_TYPES != 0 {
        return Err(format!("source types {types}"));
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
        types,
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

/// The sources the shell picked, or `None` for one not open, of a type not
/// asked for, an empty region, or more than one when the application asked
/// for one.
fn chosen(picks: &[CastPick], open: &[Candidate], selected: &Selected) -> Option<Vec<Candidate>> {
    if picks.is_empty() || (picks.len() > 1 && !selected.multiple) {
        return None;
    }
    picks
        .iter()
        .map(|pick| {
            let source = match pick {
                CastPick::Window { id, .. } => Source::Window(id.clone()),
                CastPick::BrowserWindow { id, .. } => Source::BrowserWindow(id.clone()),
                CastPick::Monitor { name } => Source::Monitor(name.clone()),
                CastPick::Region { position, size } => Source::Region(Region {
                    position: *position,
                    size: *size,
                }),
            };
            if !asked_for(selected, &source) {
                return None;
            }
            let candidate = match (source, pick) {
                (Source::Region(Region { position, size }), _) => {
                    (size.0 > 0 && size.1 > 0).then(|| region(position, size))
                }
                // Not listed: the engine has them. A closed one fails to start.
                (Source::BrowserWindow(id), CastPick::BrowserWindow { title, .. }) => {
                    Some(browser_window(id, title.clone()))
                }
                (source, _) => open
                    .iter()
                    .find(|candidate| candidate.source == source)
                    .cloned(),
            }?;
            Some(Candidate {
                part: part_of(pick),
                ..candidate
            })
        })
        .collect()
}

/// The part of a window `pick` names, or `None` for all of it or an empty
/// part.
fn part_of(pick: &CastPick) -> Option<casting::Rect> {
    match pick {
        CastPick::Window { area, .. } | CastPick::BrowserWindow { area, .. } => area
            .filter(|area| area.width > 0 && area.height > 0)
            .map(|area| {
                (
                    area.x as i32,
                    area.y as i32,
                    area.width as i32,
                    area.height as i32,
                )
            }),
        CastPick::Monitor { .. } | CastPick::Region { .. } => None,
    }
}

/// Whether `source` is of a type the application asked for.
fn asked_for(selected: &Selected, source: &Source) -> bool {
    let types = match source {
        Source::Region(_) => REGION_TYPES,
        _ => source_type(source),
    };
    selected.types & types != 0
}

/// What `stream` of `candidate` shows.
fn pick(stream: StreamId, candidate: &Candidate) -> Pick {
    let sound = match &candidate.source {
        Source::Window(id) => candidate.process.map(|process| Heard::Window {
            id: id.clone(),
            process,
        }),
        Source::Monitor(_) | Source::Region(_) => Some(Heard::Everything),
        Source::BrowserWindow(_) => None,
    };
    Pick {
        stream,
        source_type: source_type(&candidate.source),
        browser_window: match &candidate.source {
            Source::BrowserWindow(id) => id.clone(),
            _ => String::new(),
        },
        sound: sound.map(|heard| heard.node_name()).unwrap_or_default(),
    }
}

/// The spec's source type of `source`.
fn source_type(source: &Source) -> u32 {
    match source {
        Source::Monitor(_) => MONITOR,
        Source::Window(_) | Source::BrowserWindow(_) => WINDOW,
        Source::Region(_) => VIRTUAL,
    }
}

/// Browser window `id`'s page, titled `title`, as a candidate.
fn browser_window(id: String, title: String) -> Candidate {
    Candidate {
        source: Source::BrowserWindow(id),
        title,
        app_id: String::new(),
        bounds: None,
        process: None,
        part: None,
    }
}

/// A region drawn at `position` and `size`, as a candidate.
fn region(position: (i32, i32), size: (i32, i32)) -> Candidate {
    let region = Region { position, size };
    Candidate {
        source: Source::Region(region),
        title: String::new(),
        app_id: String::new(),
        bounds: Some(region),
        process: None,
        part: None,
    }
}

/// The monitors of `listed`, where they are.
fn placed(listed: &[Candidate]) -> Vec<Placed> {
    listed
        .iter()
        .filter_map(|candidate| match &candidate.source {
            Source::Monitor(name) => {
                let bounds = candidate.bounds.expect("a monitor has bounds");
                Some(Placed {
                    name: name.clone(),
                    position: bounds.position,
                    size: bounds.size,
                })
            }
            Source::Window(_) | Source::BrowserWindow(_) | Source::Region(_) => None,
        })
        .collect()
}

/// What the shell's indicator lists for `candidate`. A region is named by
/// the monitors of `screens` it covers.
fn captured(candidate: &Candidate, screens: &[Candidate]) -> Captured {
    match &candidate.source {
        Source::Window(id) => Captured::Window {
            id: id.clone(),
            title: candidate.title.clone(),
            app_id: candidate.app_id.clone(),
        },
        Source::BrowserWindow(id) => Captured::BrowserWindow {
            id: id.clone(),
            title: candidate.title.clone(),
        },
        Source::Monitor(_) => Captured::Monitor(captured_monitor(candidate)),
        Source::Region(region) => covered(*region, screens),
    }
}

/// `region` as the monitor of `screens` it covers, as the desk when it covers
/// all of several, else with the monitor it is mostly on.
fn covered(region: Region, screens: &[Candidate]) -> Captured {
    let bounds: Vec<Region> = screens
        .iter()
        .map(|screen| screen.bounds.expect("a monitor has bounds"))
        .collect();
    match bounds.iter().position(|bounds| *bounds == region) {
        Some(index) => Captured::Monitor(captured_monitor(&screens[index])),
        None if bounds.len() > 1 && around(&bounds) == region => Captured::Desk,
        None => {
            let placed = placed(screens);
            let monitor = mostly_on(region.position, region.size, &placed).map(|on| {
                captured_monitor(
                    screens
                        .iter()
                        .find(|screen| screen.source == Source::Monitor(on.name.clone()))
                        .expect("placed from these screens"),
                )
            });
            Captured::Region {
                position: region.position,
                size: region.size,
                monitor,
            }
        }
    }
}

/// The smallest region around all of `regions`, which is not empty.
fn around(regions: &[Region]) -> Region {
    let (first, rest) = regions.split_first().expect("regions to surround");
    rest.iter().fold(*first, |around, region| {
        let left = around.position.0.min(region.position.0);
        let top = around.position.1.min(region.position.1);
        let right = (around.position.0 + around.size.0).max(region.position.0 + region.size.0);
        let bottom = (around.position.1 + around.size.1).max(region.position.1 + region.size.1);
        Region {
            position: (left, top),
            size: (right - left, bottom - top),
        }
    })
}

/// Monitor `screen` as the indicator names it.
fn captured_monitor(screen: &Candidate) -> CapturedMonitor {
    match &screen.source {
        Source::Monitor(name) => CapturedMonitor {
            name: name.clone(),
            description: screen.title.clone(),
        },
        other => panic!("{other:?} is not a monitor"),
    }
}

/// A stream's properties for `Start`'s results.
fn stream_properties(candidate: &Candidate) -> HashMap<String, OwnedValue> {
    let mut properties = HashMap::from([(
        "source_type".to_string(),
        owned(Value::from(source_type(&candidate.source))),
    )]);
    match &candidate.source {
        Source::Window(id) | Source::BrowserWindow(id) | Source::Monitor(id) => {
            properties.insert("id".to_string(), owned(Value::from(id.as_str())));
        }
        Source::Region(_) => {}
    }
    if let Some(bounds) = candidate.bounds {
        properties.insert("position".to_string(), owned(Value::from(bounds.position)));
        properties.insert("size".to_string(), owned(Value::from(bounds.size)));
    }
    properties
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
        Captured, CapturedMonitor, Capturing, CapturingKind, CastPick, CastSource, PortalAnswer,
        PortalKind, PortalRequest, ScreenCastDialog,
    };
    use smithay::reexports::calloop::channel::{channel as calloop_channel, Event as Heard};
    use smithay::reexports::calloop::EventLoop;
    use zbus::zvariant::{ObjectPath, OwnedValue, Value};

    use crate::casting::{Candidate, Desk, Ended, Event, Region, Request, Source};
    use crate::portals::screenshot::{Shoot, Shots};
    use crate::portals::socket_pair::connected;
    use crate::portals::OBJECT_PATH;
    use domicile_host::screenshot::Shot;

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
    /// and `app-4` ("Todo"), with grants kept in `grants`, on a desk that
    /// cannot be shot.
    fn served(grants: Grants) -> Served {
        served_shooting(grants, Shots::none().shoot)
    }

    /// [`served`], with the desk shot by `shoot`.
    fn served_shooting(grants: Grants, shoot: Shoot) -> Served {
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
        let backend = ScreenCast::new(Arc::clone(&queue), casting, grants, shoot);
        let picks = backend.picks();
        let (server, client) = connected(|builder| {
            builder
                .serve_at(OBJECT_PATH, picks)
                .expect("the picks registered")
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
                    Heard::Msg(Request::List { reply }) => {
                        reply.send(windows().into_iter().chain(monitors()).collect())
                    }
                    Heard::Msg(Request::Start {
                        stream,
                        source,
                        part,
                        cursor,
                        mut listener,
                        ..
                    }) => {
                        let part = part
                            .map(|part| format!(" part {part:?}"))
                            .unwrap_or_default();
                        let _ = told.send(format!("start {source:?} {cursor:?}{part}"));
                        listener(Event::Ready { node: 42 });
                        listeners.insert(stream, listener);
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
                    Heard::Msg(
                        Request::ShootWindow { developed, .. }
                        | Request::ShootBrowserWindow { developed, .. },
                    ) => {
                        developed(Err("no windows here".into()));
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
                process: Some(7),
                part: None,
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
                process: None,
                part: None,
            },
        ]
    }

    /// A 1920x1080 monitor, and a 1280x800 one to its right.
    fn monitors() -> Vec<Candidate> {
        vec![
            Candidate {
                source: Source::Monitor("drm-1".into()),
                title: "BOE NE135A1M-NY1".into(),
                app_id: String::new(),
                process: None,
                part: None,
                bounds: Some(Region {
                    position: (0, 0),
                    size: (1920, 1080),
                }),
            },
            Candidate {
                source: Source::Monitor("drm-2".into()),
                title: String::new(),
                app_id: String::new(),
                process: None,
                part: None,
                bounds: Some(Region {
                    position: (1920, 0),
                    size: (1280, 800),
                }),
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

    /// Create a session and select sources with `select`.
    fn select(client: &zbus::blocking::Connection, select: Vec<(&str, Value<'static>)>) {
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
        pick(
            served,
            vec![CastPick::Window {
                id: "app-3".into(),
                area: None,
            }],
        )
    }

    /// Pick `sources` in the dialog `Start` puts up.
    fn pick(served: &Served, sources: Vec<CastPick>) -> (u32, HashMap<String, OwnedValue>) {
        let starting = start(&served.client);
        let (items, _) = next(&served.published);
        served
            .queue
            .answer(items[0].id, PortalAnswer::ScreenCast { sources });
        starting.join().expect("Start returned")
    }

    /// Each stream's properties in `Start`'s results.
    fn streams(results: &HashMap<String, OwnedValue>) -> Vec<HashMap<String, OwnedValue>> {
        let streams: Vec<(u32, HashMap<String, OwnedValue>)> = results
            .get("streams")
            .expect("streams")
            .try_clone()
            .expect("cloned")
            .try_into()
            .expect("a(ua{sv})");
        streams
            .into_iter()
            .map(|(node, properties)| {
                assert_eq!(node, 42);
                properties
            })
            .collect()
    }

    /// Property `name` of a stream, read as `T`.
    fn read<T>(properties: &HashMap<String, OwnedValue>, name: &str) -> T
    where
        T: TryFrom<OwnedValue>,
        T::Error: std::fmt::Debug,
    {
        T::try_from(
            properties
                .get(name)
                .expect(name)
                .try_clone()
                .expect("cloned"),
        )
        .expect(name)
    }

    /// The last capture list the queue published.
    fn captured(served: &Served) -> Vec<Captured> {
        match served
            .published
            .try_iter()
            .last()
            .map(|(_, capturing)| capturing)
            .as_deref()
        {
            Some(
                [Capturing {
                    kind: CapturingKind::ScreenCast { sources },
                    ..
                }],
            ) => sources.clone(),
            other => panic!("not one screen cast: {other:?}"),
        }
    }

    fn close(served: &Served) {
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
        select(&served.client, vec![("types", Value::from(2u32))]);
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
                            app_id: "org.gnome.TextEditor".into(),
                        },
                        CastSource::Window {
                            id: "app-4".into(),
                            title: "Todo".into(),
                            app_id: String::new(),
                        },
                    ],
                    region: false,
                    browser_windows: true,
                    desk: None,
                }),
            }]
        );
        served.queue.answer(items[0].id, PortalAnswer::Canceled);
        assert_eq!(starting.join().expect("Start returned").0, 1);
    }

    #[test]
    fn the_shell_offers_monitors_and_a_region_when_asked_for() {
        let served = served(Grants::default());
        select(
            &served.client,
            vec![
                // A region is part of a monitor, so asking for monitors is
                // asking for regions too.
                ("types", Value::from(1u32)),
                ("multiple", Value::from(true)),
            ],
        );
        let starting = start(&served.client);

        let (items, _) = next(&served.published);

        assert_eq!(
            items[0].kind,
            PortalKind::ScreenCast(ScreenCastDialog {
                multiple: true,
                sources: vec![
                    CastSource::Monitor {
                        name: "drm-1".into(),
                        description: "BOE NE135A1M-NY1".into(),
                        size: (1920, 1080),
                    },
                    CastSource::Monitor {
                        name: "drm-2".into(),
                        description: String::new(),
                        size: (1280, 800),
                    },
                ],
                region: true,
                browser_windows: false,
                desk: None,
            })
        );
        served.queue.answer(items[0].id, PortalAnswer::Canceled);
        starting.join().expect("Start returned");
    }

    #[test]
    fn the_picker_shows_the_desk_to_preview_the_sources_on() {
        let shoot: Shoot = Arc::new(|| {
            Box::pin(async {
                Ok(Desk {
                    shot: Shot {
                        width: 1,
                        height: 1,
                        bgra: vec![0, 51, 255, 255],
                    },
                    monitors: vec![],
                    windows: vec![],
                    place: (0, 0, 1, 1),
                })
            })
        });
        let served = served_shooting(Grants::default(), shoot);
        select(&served.client, vec![("types", Value::from(1u32))]);
        let starting = start(&served.client);

        let (items, _) = next(&served.published);

        let PortalKind::ScreenCast(ScreenCastDialog {
            desk: Some(desk), ..
        }) = &items[0].kind
        else {
            panic!("no desk to preview on: {:?}", items[0].kind);
        };
        assert!(desk.frame.starts_with("data:image/png;base64,"));
        assert_eq!((desk.width, desk.height), (1, 1));
        served.queue.answer(items[0].id, PortalAnswer::Canceled);
        starting.join().expect("Start returned");
    }

    /// What `Pick` says of node 42, the fake Wayland thread's every stream.
    fn picked(served: &Served) -> zbus::Result<(u32, String, String)> {
        served
            .client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.domicile.ScreenCast"),
                "Pick",
                &(42u32,),
            )
            .map(|reply| reply.body().deserialize().expect("(uss)"))
    }

    #[test]
    fn the_engine_learns_what_a_streams_node_shows() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(2u32))]);
        assert!(picked(&served).is_err(), "nothing is cast yet");

        pick_notes(&served);
        heard(&served.casts);

        assert_eq!(
            picked(&served).expect("a pick"),
            (2, String::new(), "domicile-sound-window-app-3".into())
        );
        close(&served);
        heard(&served.casts);
        assert!(picked(&served).is_err(), "the stream ended");
    }

    #[test]
    fn a_monitors_stream_carries_the_desks_sound() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(1u32))]);

        pick(
            &served,
            vec![CastPick::Monitor {
                name: "drm-1".into(),
            }],
        );
        heard(&served.casts);

        assert_eq!(
            picked(&served).expect("a pick"),
            (1, String::new(), "domicile-sound-desk".into())
        );
    }

    #[test]
    fn a_browser_windows_stream_names_it_and_carries_no_sound() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(2u32))]);

        pick(&served, vec![meet()]);
        heard(&served.casts);

        assert_eq!(
            picked(&served).expect("a pick"),
            (2, "7".into(), String::new())
        );
    }

    #[test]
    fn a_picked_browser_window_is_cast_by_the_engines_id() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(2u32))]);

        let (response, results) = pick(&served, vec![meet()]);

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), r#"start BrowserWindow("7") Hidden"#);
        assert_eq!(read::<u32>(&streams(&results)[0], "source_type"), 2);
        assert_eq!(
            captured(&served),
            [Captured::BrowserWindow {
                id: "7".into(),
                title: "Meet".into(),
            }]
        );
    }

    #[test]
    fn a_restore_token_shares_the_same_browser_window_without_asking() {
        let served = served(Grants::default());
        let windows = |restore: Option<OwnedValue>| {
            let mut options = vec![
                ("types", Value::from(2u32)),
                ("persist_mode", Value::from(1u32)),
            ];
            if let Some(restore) = restore {
                options.push(("restore_data", Value::from(restore)));
            }
            options
        };
        select(&served.client, windows(None));
        let (_, results) = pick(&served, vec![meet()]);
        heard(&served.casts);
        let restore = results
            .get("restore_data")
            .expect("a token")
            .try_clone()
            .expect("cloned");
        close(&served);
        heard(&served.casts);

        select(&served.client, windows(Some(restore)));
        let (response, _) = start(&served.client).join().expect("Start returned");

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), r#"start BrowserWindow("7") Hidden"#);
        assert!(
            served
                .published
                .try_iter()
                .all(|(items, _)| items.is_empty()),
            "no dialog was shown"
        );
    }

    #[test]
    fn a_browser_window_is_not_granted_past_a_restart() {
        // The engine's ids start over with it.
        let served = served(Grants::default());
        select(
            &served.client,
            vec![
                ("types", Value::from(2u32)),
                ("persist_mode", Value::from(2u32)),
            ],
        );

        let (response, results) = pick(&served, vec![meet()]);

        assert_eq!(response, 0);
        assert!(!results.contains_key("restore_data"));
    }

    #[test]
    fn a_restore_token_shares_the_same_part_of_a_window_without_asking() {
        // A page's capture restores the pick of its picker session this way.
        let windows = |restore: Option<OwnedValue>| {
            let mut options = vec![
                ("types", Value::from(2u32)),
                ("persist_mode", Value::from(1u32)),
            ];
            if let Some(restore) = restore {
                options.push(("restore_data", Value::from(restore)));
            }
            options
        };
        for (part, cast) in [
            (
                notes_part(),
                r#"start Window("app-3") Hidden part (1, 2, 3, 4)"#,
            ),
            (
                CastPick::BrowserWindow {
                    id: "7".into(),
                    title: "Meet".into(),
                    area: Some(domicile_protocol::ShotRect {
                        x: 5,
                        y: 6,
                        width: 7,
                        height: 8,
                    }),
                },
                r#"start BrowserWindow("7") Hidden part (5, 6, 7, 8)"#,
            ),
        ] {
            let served = served(Grants::default());
            select(&served.client, windows(None));
            let (_, results) = pick(&served, vec![part]);
            heard(&served.casts);
            let restore = results
                .get("restore_data")
                .expect("a token")
                .try_clone()
                .expect("cloned");
            close(&served);
            heard(&served.casts);

            select(&served.client, windows(Some(restore)));
            let (response, _) = start(&served.client).join().expect("Start returned");

            assert_eq!(response, 0);
            assert_eq!(heard(&served.casts), cast);
            assert!(
                served
                    .published
                    .try_iter()
                    .all(|(items, _)| items.is_empty()),
                "no dialog was shown"
            );
        }
    }

    #[test]
    fn a_part_of_a_window_is_not_granted_past_a_restart() {
        // It is in the pixels of a frame the restart does not keep.
        let served = served(Grants::default());
        select(
            &served.client,
            vec![
                ("types", Value::from(2u32)),
                ("persist_mode", Value::from(2u32)),
            ],
        );

        let (response, results) = pick(&served, vec![notes_part()]);

        assert_eq!(response, 0);
        assert!(!results.contains_key("restore_data"));
    }

    /// A part of window `app-3` as the shell picks it.
    fn notes_part() -> CastPick {
        CastPick::Window {
            id: "app-3".into(),
            area: Some(domicile_protocol::ShotRect {
                x: 1,
                y: 2,
                width: 3,
                height: 4,
            }),
        }
    }

    /// Browser window `7`, "Meet", as the shell picks it.
    fn meet() -> CastPick {
        CastPick::BrowserWindow {
            id: "7".into(),
            title: "Meet".into(),
            area: None,
        }
    }

    #[test]
    fn a_picked_monitor_is_cast_with_its_place_and_the_cursor_mode() {
        let served = served(Grants::default());
        select(
            &served.client,
            vec![
                ("types", Value::from(1u32)),
                ("cursor_mode", Value::from(4u32)),
            ],
        );

        let (response, results) = pick(
            &served,
            vec![CastPick::Monitor {
                name: "drm-2".into(),
            }],
        );

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), r#"start Monitor("drm-2") Metadata"#);
        let stream = &streams(&results)[0];
        assert_eq!(read::<u32>(stream, "source_type"), 1);
        assert_eq!(read::<(i32, i32)>(stream, "position"), (1920, 0));
        assert_eq!(read::<(i32, i32)>(stream, "size"), (1280, 800));
        assert_eq!(
            captured(&served),
            [Captured::Monitor(CapturedMonitor {
                name: "drm-2".into(),
                description: String::new(),
            })]
        );
    }

    #[test]
    fn a_drawn_region_is_cast_where_it_was_drawn() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(4u32))]);

        let (response, results) = pick(
            &served,
            vec![CastPick::Region {
                position: (1800, 100),
                size: (300, 200),
            }],
        );

        assert_eq!(response, 0);
        assert_eq!(
            heard(&served.casts),
            "start Region(Region { position: (1800, 100), size: (300, 200) }) Hidden"
        );
        let stream = &streams(&results)[0];
        assert_eq!(read::<u32>(stream, "source_type"), 4);
        assert_eq!(read::<(i32, i32)>(stream, "position"), (1800, 100));
        assert_eq!(read::<(i32, i32)>(stream, "size"), (300, 200));
        assert_eq!(
            captured(&served),
            [Captured::Region {
                position: (1800, 100),
                size: (300, 200),
                monitor: Some(CapturedMonitor {
                    name: "drm-2".into(),
                    description: String::new(),
                }),
            }]
        );
    }

    #[test]
    fn a_region_over_one_whole_monitor_is_listed_as_that_monitor() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(4u32))]);

        pick(
            &served,
            vec![CastPick::Region {
                position: (0, 0),
                size: (1920, 1080),
            }],
        );

        assert_eq!(
            captured(&served),
            [Captured::Monitor(CapturedMonitor {
                name: "drm-1".into(),
                description: "BOE NE135A1M-NY1".into(),
            })]
        );
    }

    #[test]
    fn a_region_over_every_monitor_is_listed_as_the_desk() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(4u32))]);

        pick(
            &served,
            vec![CastPick::Region {
                position: (0, 0),
                size: (3200, 1080),
            }],
        );

        assert_eq!(captured(&served), [Captured::Desk]);
    }

    #[test]
    fn a_restore_token_shares_the_same_monitor_and_region_without_asking() {
        let served = served(Grants::default());
        let both = |restore: Option<OwnedValue>| {
            let mut options = vec![
                ("types", Value::from(1u32 | 4)),
                ("multiple", Value::from(true)),
                ("persist_mode", Value::from(1u32)),
            ];
            if let Some(restore) = restore {
                options.push(("restore_data", Value::from(restore)));
            }
            options
        };
        select(&served.client, both(None));
        let (_, results) = pick(
            &served,
            vec![
                CastPick::Monitor {
                    name: "drm-1".into(),
                },
                CastPick::Region {
                    position: (1800, 100),
                    size: (300, 200),
                },
            ],
        );
        heard(&served.casts);
        heard(&served.casts);
        let restore = results
            .get("restore_data")
            .expect("a token")
            .try_clone()
            .expect("cloned");
        close(&served);
        heard(&served.casts);
        heard(&served.casts);

        select(&served.client, both(Some(restore)));
        let (response, _) = start(&served.client).join().expect("Start returned");

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), r#"start Monitor("drm-1") Hidden"#);
        assert_eq!(
            heard(&served.casts),
            "start Region(Region { position: (1800, 100), size: (300, 200) }) Hidden"
        );
        assert!(
            served
                .published
                .try_iter()
                .all(|(items, _)| items.is_empty()),
            "no dialog was shown"
        );
    }

    #[test]
    fn a_picked_window_is_cast_and_its_node_handed_back() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(2u32))]);

        let (response, results) = pick_notes(&served);

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), r#"start Window("app-3") Hidden"#);
        let stream = &streams(&results)[0];
        assert_eq!(read::<u32>(stream, "source_type"), 2);
        assert_eq!(read::<(i32, i32)>(stream, "size"), (640, 480));
        assert_eq!(read::<(i32, i32)>(stream, "position"), (10, 20));
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
                        app_id: "org.gnome.TextEditor".into(),
                    }],
                },
            }])
        );
    }

    #[test]
    fn closing_the_session_stops_its_streams() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(2u32))]);
        pick_notes(&served);
        heard(&served.casts);

        close(&served);

        assert_eq!(heard(&served.casts), "stop");
        assert_eq!(next(&served.published).1, []);
    }

    #[test]
    fn the_shell_s_stop_ends_the_session() {
        let served = served(Grants::default());
        select(&served.client, vec![("types", Value::from(2u32))]);
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
        select(
            &served.client,
            vec![
                ("types", Value::from(2u32)),
                ("persist_mode", Value::from(2u32)),
            ],
        );
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
        close(&served);
        heard(&served.casts);

        select(
            &served.client,
            vec![
                ("types", Value::from(2u32)),
                ("persist_mode", Value::from(2u32)),
                ("restore_data", Value::from(restore)),
            ],
        );
        let (response, _) = start(&served.client).join().expect("Start returned");

        assert_eq!(response, 0);
        assert_eq!(heard(&served.casts), r#"start Window("app-3") Hidden"#);
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

        let types = |types: u32| selected(&options(vec![("types", Value::from(types))]));

        assert!(windows_and("cursor_mode", 8).is_err());
        assert!(windows_and("persist_mode", 3).is_err());
        assert!(windows_and("cursor_mode", 4).is_ok());
        assert!(types(0).is_err(), "no source type");
        assert!(types(8).is_err(), "a type the spec does not define");
        assert!(types(7).is_ok());
        assert_eq!(
            selected(&options(vec![])).map(|selected| selected.types),
            Ok(1),
            "a monitor, by default"
        );
    }

    #[test]
    fn the_shell_may_pick_only_what_was_asked_for() {
        let asked =
            |types: u32| selected(&options(vec![("types", Value::from(types))])).expect("selected");
        let open: Vec<Candidate> = windows().into_iter().chain(monitors()).collect();
        let window = |id: &str| CastPick::Window {
            id: id.into(),
            area: None,
        };
        let monitor = |name: &str| CastPick::Monitor { name: name.into() };
        let region = |size: (i32, i32)| CastPick::Region {
            position: (0, 0),
            size,
        };

        assert!(chosen(&[window("app-3"), window("app-4")], &open, &asked(2)).is_none());
        assert!(
            chosen(&[window("app-9")], &open, &asked(2)).is_none(),
            "not open"
        );
        assert!(chosen(&[], &open, &asked(2)).is_none());
        assert!(
            chosen(&[monitor("drm-1")], &open, &asked(2)).is_none(),
            "windows only"
        );
        assert!(
            chosen(&[meet()], &open, &asked(1)).is_none(),
            "a browser window is a window"
        );
        assert!(
            chosen(&[region((10, 10))], &open, &asked(2)).is_none(),
            "no region"
        );
        assert_eq!(
            chosen(&[region((10, 10))], &open, &asked(1)),
            Some(vec![super::region((0, 0), (10, 10))]),
            "a region of a monitor"
        );
        assert!(
            chosen(&[region((0, 10))], &open, &asked(4)).is_none(),
            "empty"
        );
        assert_eq!(
            chosen(&[window("app-4")], &open, &asked(2)),
            Some(vec![windows()[1].clone()])
        );
        assert_eq!(
            chosen(&[monitor("drm-2")], &open, &asked(1)),
            Some(vec![monitors()[1].clone()])
        );
    }

    /// A part of a window dragged over its preview is cast alone; an empty
    /// one is all of it.
    #[test]
    fn the_shell_may_pick_part_of_a_window() {
        let asked = selected(&options(vec![("types", Value::from(2u32))])).expect("selected");
        let open: Vec<Candidate> = windows().into_iter().chain(monitors()).collect();
        let part = |width, height| CastPick::Window {
            id: "app-4".into(),
            area: Some(domicile_protocol::ShotRect {
                x: 1,
                y: 2,
                width,
                height,
            }),
        };

        assert_eq!(
            chosen(&[part(3, 4)], &open, &asked),
            Some(vec![Candidate {
                process: None,
                part: Some((1, 2, 3, 4)),
                ..windows()[1].clone()
            }])
        );
        assert_eq!(
            chosen(&[part(0, 4)], &open, &asked),
            Some(vec![windows()[1].clone()])
        );
    }

    #[test]
    fn every_source_type_and_cursor_mode_is_offered() {
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

        assert_eq!(property("AvailableSourceTypes"), 7);
        assert_eq!(property("AvailableCursorModes"), 7);
        assert_eq!(property("version"), 5);
    }
}
