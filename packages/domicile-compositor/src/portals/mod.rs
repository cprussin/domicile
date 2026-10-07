//! The desktop's `xdg-desktop-portal` backend: one bus name, one object, every
//! interface Domicile implements.
//!
//! Each interface is a file here that registers on [`OBJECT_PATH`] in
//! [`export`]. One that needs the user calls [`queue::ask`], which pushes the
//! dialog to every chrome as
//! [`HostMessage::PortalRequests`](domicile_protocol::HostMessage::PortalRequests)
//! and waits for the shell's answer. See `docs/architecture/PORTALS.md`.
//!
//! `xdg-desktop-portal` routes to this backend by `XDG_CURRENT_DESKTOP`. It is
//! activated by D-Bus or systemd, so it reads that from their activation
//! environment, not from this process's clients. [`say_which_desktop`] sets it
//! there. This does not re-route a frontend that is already running.
//!
//! Failures (no session bus, name taken) are logged once and leave clients
//! unthemed and their dialogs unanswered; they never stop the compositor.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use domicile_config::ThemeConfig;
use domicile_host::data_dirs::data_dirs;
use domicile_host::portal_notifications::Invoked;
use domicile_protocol::{Capturing, PortalAnswer, PortalRequest, Theme};
use tracing::{debug, warn};
use zbus::blocking::connection::Builder;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

use crate::eis::barriers::Zone;
use crate::eis::{Captured, Eis};
use crate::notifications::NotificationServer;

mod access;
mod app_chooser;
mod clipboard;
mod file_chooser;
#[cfg(test)]
mod fixture;
mod inhibit;
mod input_capture;
mod notification;
mod queue;
mod remote_desktop;
mod reply;
mod request;
mod restore;
mod session;
mod settings;
#[cfg(test)]
mod socket_pair;

use access::Access;
use app_chooser::AppChooser;
pub use clipboard::Selection;
use clipboard::{Clipboard, Transfers};
use file_chooser::FileChooser;
use inhibit::{Inhibit, Inhibitors};
use input_capture::{InputCapture, Inputs, Zones};
use notification::Notification;
use queue::Queue;
use remote_desktop::{RemoteDesktop, Remotes};
use restore::Tokens;
use settings::{color_scheme, Appearance, Settings};

/// The object path the frontend calls backends at.
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";

/// The bus name this backend owns.
///
/// Owns the backend name, not the frontend's `org.freedesktop.portal.Desktop`,
/// so other portal interfaces still reach their own backends.
const BUS_NAME: &str = "org.freedesktop.impl.portal.desktop.domicile";

/// The Clipboard interface, for its signals.
const CLIPBOARD: &str = "org.freedesktop.impl.portal.Clipboard";

/// The InputCapture interface, for its signals.
const INPUT_CAPTURE: &str = "org.freedesktop.impl.portal.InputCapture";

/// This desktop's `XDG_CURRENT_DESKTOP` value.
///
/// Must match `UseIn=` in the flake's `domicile.portal`. `.desktop` files'
/// `OnlyShowIn`/`NotShowIn` also match on it. [`say_which_desktop`] sets it
/// for activated services and `client_command` for spawned clients.
pub const CURRENT_DESKTOP: &str = "domicile";

/// Handle for the portal thread: the desk's state in, the shell's answers in.
///
/// If the service failed to start, changes are dropped and every dialog is
/// refused, so callers need no separate path for a desk without a portal.
#[derive(Clone)]
pub struct Portals {
    backends: Backends,
}

/// What the portal thread is told to do on the bus.
enum Told {
    Theme(Theme),
    Appearance(Appearance),
    Screensaver(bool),
    /// End the session at this handle, as when the shell stops it.
    End(OwnedObjectPath),
    /// The clipboard now offers `mime_types`, from `owner` if a session set
    /// it.
    SelectionChanged {
        mime_types: Vec<String>,
        owner: Option<OwnedObjectPath>,
    },
    /// A client is pasting `session`'s offer as `mime_type` into `fd`.
    Transfer {
        session: OwnedObjectPath,
        mime_type: String,
        fd: std::os::fd::OwnedFd,
    },
    /// The displays changed to zone set `set`.
    Rezoned {
        set: u32,
    },
    /// An InputCapture session's capture says something.
    Captured {
        session: OwnedObjectPath,
        captured: Captured,
    },
}

impl Portals {
    /// A handle with no service behind it, for unit tests without a session
    /// bus.
    #[cfg(test)]
    pub fn to_nobody() -> Self {
        // Same state as a service thread that has stopped.
        Portals {
            backends: Backends::new(NotificationServer::unserved(Vec::new()), Tokens::load(None)).0,
        }
    }

    /// Tells the desk's clients the current theme. Dropped if no service is
    /// running.
    pub fn announce(&self, theme: Theme) {
        self.tell(Told::Theme(theme));
    }

    /// Tells the desk's clients the config's accent color, contrast and
    /// reduced motion.
    pub fn restyle(&self, theme: &ThemeConfig) {
        self.tell(Told::Appearance(Appearance::from(theme)));
    }

    /// Tells applications watching the session whether the screens are
    /// blanked or locked.
    pub fn screensaver(&self, active: bool) {
        self.tell(Told::Screensaver(active));
    }

    /// Publish the pending dialogs through `publish` on every change. See
    /// [`Queue::listen`] for `listening` and `parent`.
    pub fn listen(
        &self,
        publish: impl Fn(Vec<PortalRequest>, Vec<Capturing>) + Send + Sync + 'static,
        listening: impl Fn() -> bool + Send + Sync + 'static,
        parent: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) {
        self.backends.queue.listen(publish, listening, parent);
    }

    /// Call `hold` with whether any application's idle inhibitor is held, on
    /// each change.
    pub fn hold_idle_through(&self, hold: impl Fn(bool) + Send + Sync + 'static) {
        self.backends.inhibitors.hold_idle_through(hold);
    }

    /// The shell's answer to dialog `id`.
    pub fn answer(&self, id: u32, answer: PortalAnswer) {
        self.backends.queue.answer(id, answer);
    }

    /// Serve RemoteDesktop's and InputCapture's input through `eis`, and the
    /// Clipboard through `selections`. Called once, when the Wayland loop
    /// starts.
    pub fn attach(&self, eis: Eis, selections: impl Fn(Selection) + Send + Sync + 'static) {
        self.backends.attach(eis, selections);
    }

    /// The seat's clipboard now offers `mime_types`; `owner` is the session
    /// that set it, if one did.
    pub fn selection_changed(&self, mime_types: Vec<String>, owner: Option<OwnedObjectPath>) {
        self.backends.selection_changed(mime_types, owner);
    }

    /// The displays, as InputCapture zones, in desktop logical units.
    pub fn displays(&self, zones: Vec<Zone>) {
        self.backends.displays(zones);
    }

    /// A client is pasting `session`'s offer into `fd`.
    pub fn transfer(&self, session: OwnedObjectPath, mime_type: String, fd: std::os::fd::OwnedFd) {
        self.backends.transfer(session, mime_type, fd);
    }

    fn tell(&self, told: Told) {
        self.backends.tell(told);
    }
}

/// What the interfaces share with [`Portals`] and the rest of the desk: the
/// dialogs, the input server, the sessions, and the way to the portal thread.
#[derive(Clone)]
struct Backends {
    queue: Arc<Queue>,
    inhibitors: Arc<Inhibitors>,
    notifications: NotificationServer,
    told: Sender<Told>,
    /// Set once the Wayland loop serves EIS; see [`Portals::attach`].
    eis: Arc<OnceLock<Eis>>,
    remotes: Arc<Remotes>,
    tokens: Arc<Mutex<Tokens>>,
    /// Where clipboard requests go on the Wayland thread. Set with `eis`.
    selections: Arc<OnceLock<Box<Select>>>,
    transfers: Arc<Mutex<Transfers>>,
    inputs: Arc<Inputs>,
    zones: Arc<Mutex<Zones>>,
}

/// Hands a [`Selection`] to the Wayland thread.
type Select = dyn Fn(Selection) + Send + Sync;

impl Backends {
    /// Backends posting notifications to `notifications` and keeping grants
    /// in `tokens`, and what they tell the portal thread.
    fn new(notifications: NotificationServer, tokens: Tokens) -> (Backends, Receiver<Told>) {
        let (told, telling) = channel();
        let backends = Backends {
            queue: Arc::default(),
            inhibitors: Arc::default(),
            notifications,
            told,
            eis: Arc::default(),
            remotes: Arc::default(),
            tokens: Arc::new(Mutex::new(tokens)),
            selections: Arc::default(),
            transfers: Arc::default(),
            inputs: Arc::default(),
            zones: Arc::default(),
        };
        (backends, telling)
    }

    fn attach(&self, eis: Eis, selections: impl Fn(Selection) + Send + Sync + 'static) {
        if self.eis.set(eis).is_err() || self.selections.set(Box::new(selections)).is_err() {
            panic!("the portals are attached to one desktop");
        }
    }

    /// The input server, or an error for the application before it is up.
    fn eis(&self) -> zbus::fdo::Result<&Eis> {
        self.eis
            .get()
            .ok_or_else(|| zbus::fdo::Error::Failed("the desktop takes no input yet".into()))
    }

    /// Hand `selection` to the Wayland thread, or fail before it is up.
    fn select(&self, selection: Selection) -> zbus::fdo::Result<()> {
        let select = self
            .selections
            .get()
            .ok_or_else(|| zbus::fdo::Error::Failed("the desktop has no clipboard yet".into()))?;
        select(selection);
        Ok(())
    }

    /// The displays are now `zones`.
    fn displays(&self, zones: Vec<Zone>) {
        let mut held = self.zones.lock().unwrap();
        if held.replace(zones) {
            self.tell(Told::Rezoned { set: held.set });
        }
    }

    fn selection_changed(&self, mime_types: Vec<String>, owner: Option<OwnedObjectPath>) {
        self.tell(Told::SelectionChanged { mime_types, owner });
    }

    fn transfer(&self, session: OwnedObjectPath, mime_type: String, fd: std::os::fd::OwnedFd) {
        self.tell(Told::Transfer {
            session,
            mime_type,
            fd,
        });
    }

    fn tell(&self, told: Told) {
        // A closed channel means the service stopped and already logged why.
        let _ = self.told.send(told);
    }
}

/// Starts the portal thread with `theme` as the current theme, and sets the
/// activation environment. See [`activation_environment`] for `ours` and
/// `nested_in`. Portal notifications go to `notifications`.
///
/// Returns without waiting for the bus, so startup never blocks on D-Bus.
pub fn serve(
    theme: Theme,
    look: &ThemeConfig,
    ours: &str,
    nested_in: Option<&OsStr>,
    notifications: NotificationServer,
) -> Portals {
    let environment = activation_environment(ours, nested_in);
    let (backends, changes) = Backends::new(
        notifications,
        Tokens::load(restore::path(
            std::env::var_os("XDG_STATE_HOME").map(PathBuf::from),
            std::env::var_os("HOME").map(PathBuf::from),
        )),
    );
    let portals = Portals {
        backends: backends.clone(),
    };
    let appearance = Appearance::from(look);
    thread::spawn(move || {
        // Every failure has the same effect: clients do not follow the theme,
        // and their dialogs go unanswered.
        if let Err(why) = answer(theme, appearance, &backends, &environment, &changes) {
            warn!(
                %why,
                "the desktop portal is not being answered; this desktop's \
                 clients will not follow its theme or show its dialogs"
            );
        }
    });
    portals
}

/// Sets the activation environment, serves the interfaces, and signals each
/// change. Returns on failure or when every handle is dropped.
///
/// Sets the environment before taking the name, so it is set even if another
/// desk holds the name.
fn answer(
    theme: Theme,
    appearance: Appearance,
    backends: &Backends,
    environment: &[(&str, String)],
    changes: &Receiver<Told>,
) -> Result<(), zbus::Error> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let data_dirs = data_dirs(
        std::env::var_os("XDG_DATA_HOME"),
        std::env::var_os("XDG_DATA_DIRS"),
        home.as_deref(),
    );
    let home = home.unwrap_or_else(|| "/".into()).display().to_string();
    let connection = export(
        Builder::session()?,
        theme,
        appearance,
        backends,
        data_dirs,
        home,
    )?
    .build()?;
    say_which_desktop(&connection, environment);
    let notification = connection
        .object_server()
        .interface::<_, Notification>(OBJECT_PATH)?;
    backends
        .notifications
        .on_portal_action(move |invoked: Invoked<OwnedValue>| {
            notification::invoked(&notification, invoked)
        });
    connection.request_name(BUS_NAME)?;
    debug!(
        name = BUS_NAME,
        scheme = color_scheme(theme),
        "this desktop answers the desktop portal, so its clients follow its theme"
    );
    // Ends when every `Portals` is dropped.
    for next in changes {
        heard(&connection, backends, next)?;
    }
    Ok(())
}

/// Do one thing the portal thread was told.
fn heard(
    connection: &zbus::blocking::Connection,
    backends: &Backends,
    told: Told,
) -> zbus::Result<()> {
    match told {
        Told::Theme(theme) => settings::changed(&settings(connection)?, Some(theme), None),
        Told::Appearance(appearance) => {
            settings::changed(&settings(connection)?, None, Some(appearance))
        }
        Told::Screensaver(active) => inhibit::screensaver(
            &connection
                .object_server()
                .interface::<_, Inhibit>(OBJECT_PATH)?,
            active,
        ),
        Told::End(handle) => {
            zbus::block_on(session::end(connection.object_server().inner(), &handle))
        }
        Told::SelectionChanged { mime_types, owner } => {
            for session in backends.remotes.sharing_sessions() {
                let is_owner = owner.as_ref() == Some(&session);
                connection.emit_signal(
                    None::<&str>,
                    OBJECT_PATH,
                    CLIPBOARD,
                    "SelectionOwnerChanged",
                    &(&session, clipboard::owner_changed(&mime_types, is_owner)),
                )?;
            }
            Ok(())
        }
        Told::Transfer {
            session,
            mime_type,
            fd,
        } => match backends.remotes.sharing(&session) {
            Ok(()) => {
                let serial = backends.transfers.lock().unwrap().hold(session.clone(), fd);
                connection.emit_signal(
                    None::<&str>,
                    OBJECT_PATH,
                    CLIPBOARD,
                    "SelectionTransfer",
                    &(&session, mime_type, serial),
                )
            }
            // The session ended after the client asked: dropping the pipe
            // pastes nothing.
            Err(why) => {
                debug!(%why, "a paste of a portal session's offer found no session");
                Ok(())
            }
        },
        Told::Rezoned { set } => {
            for session in backends.inputs.rezoned() {
                connection.emit_signal(
                    None::<&str>,
                    OBJECT_PATH,
                    INPUT_CAPTURE,
                    "ZonesChanged",
                    &(
                        &session,
                        HashMap::from([("zone_set", zbus::zvariant::Value::from(set))]),
                    ),
                )?;
            }
            Ok(())
        }
        Told::Captured {
            session,
            captured:
                Captured::Activated {
                    activation_id,
                    cursor,
                    barrier_id,
                },
        } => connection.emit_signal(
            None::<&str>,
            OBJECT_PATH,
            INPUT_CAPTURE,
            "Activated",
            &(
                &session,
                input_capture::activated(activation_id, (cursor.x, cursor.y), barrier_id),
            ),
        ),
    }
}

/// The `Settings` interface, to signal a change on.
fn settings(
    connection: &zbus::blocking::Connection,
) -> zbus::Result<zbus::blocking::object_server::InterfaceRef<Settings>> {
    connection
        .object_server()
        .interface::<_, Settings>(OBJECT_PATH)
}

/// Registers every interface at [`OBJECT_PATH`].
///
/// On the builder, so the interfaces are there before the first call can
/// arrive.
///
/// `data_dirs` are where `FileChooser` finds MIME types, and `home` is the
/// user's home directory.
fn export<'a>(
    builder: Builder<'a>,
    theme: Theme,
    appearance: Appearance,
    backends: &Backends,
    data_dirs: Vec<PathBuf>,
    home: String,
) -> zbus::Result<Builder<'a>> {
    builder
        .serve_at(OBJECT_PATH, Settings { theme, appearance })?
        .serve_at(
            OBJECT_PATH,
            Access {
                queue: Arc::clone(&backends.queue),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            AppChooser {
                queue: Arc::clone(&backends.queue),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            Notification {
                notifications: backends.notifications.clone(),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            Inhibit {
                queue: Arc::clone(&backends.queue),
                inhibitors: Arc::clone(&backends.inhibitors),
                screensaver_active: false,
            },
        )?
        .serve_at(
            OBJECT_PATH,
            FileChooser {
                queue: Arc::clone(&backends.queue),
                data_dirs,
                home,
            },
        )?
        .serve_at(
            OBJECT_PATH,
            RemoteDesktop {
                backends: backends.clone(),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            Clipboard {
                backends: backends.clone(),
            },
        )?
        .serve_at(
            OBJECT_PATH,
            InputCapture {
                backends: backends.clone(),
            },
        )
}

/// The variables [`say_which_desktop`] sets for activated services.
///
/// Sets `XDG_CURRENT_DESKTOP` and `WAYLAND_DISPLAY` (`ours`) only when this
/// desk is the session. When nested in another session (`nested_in` is the
/// compositor's own non-empty `WAYLAND_DISPLAY`), sets nothing: that session
/// owns its activated apps and portal routing. The activation environment is
/// per user, so the last session to start wins, as with
/// `dbus-update-activation-environment`. The supervisor sets the same values
/// in `domicile_launch::graphical_session`.
fn activation_environment(ours: &str, nested_in: Option<&OsStr>) -> Vec<(&'static str, String)> {
    match nested_in.filter(|display| !display.is_empty()) {
        Some(_) => Vec::new(),
        None => vec![
            ("XDG_CURRENT_DESKTOP", CURRENT_DESKTOP.to_string()),
            ("WAYLAND_DISPLAY", ours.to_string()),
        ],
    }
}

/// Sets [`activation_environment`] in the D-Bus and systemd user activation
/// environments, like `dbus-update-activation-environment --systemd`.
///
/// Without this `xdg-desktop-portal` never routes to this backend. Both calls
/// are best effort and log at `debug`: a desk without a systemd user manager
/// is normal.
fn say_which_desktop(connection: &zbus::blocking::Connection, environment: &[(&str, String)]) {
    // For services D-Bus starts directly.
    let bus = zbus::blocking::Proxy::new(
        connection,
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
    );
    let told_the_bus = bus.and_then(|bus| {
        bus.call::<_, _, ()>(
            "UpdateActivationEnvironment",
            &(environment
                .iter()
                .map(|(key, value)| (*key, value.as_str()))
                .collect::<HashMap<_, _>>(),),
        )
    });
    if let Err(why) = told_the_bus {
        tracing::debug!(%why, "the session bus would not take this desktop's name");
    }

    // For services started as systemd user units, which is how most
    // distributions start the portal frontend.
    let systemd = zbus::blocking::Proxy::new(
        connection,
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
    );
    let told_systemd = systemd.and_then(|systemd| {
        systemd.call::<_, _, ()>(
            "SetEnvironment",
            &(environment
                .iter()
                .map(|(key, value)| format!("{key}={value}"))
                .collect::<Vec<_>>(),),
        )
    });
    if let Err(why) = told_systemd {
        tracing::debug!(%why, "no systemd user manager to tell this desktop's name to");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use domicile_protocol::{
        AccessDialog, AppChooserDialog, FileChooserAnswer, Inhibited, Inhibition,
        Notification as Shown, PortalKind,
    };
    use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};

    /// The frontend's handle for the dialog these tests open.
    const HANDLE: &str = "/org/freedesktop/portal/desktop/request/1_7/t";

    /// The interfaces served to a client, and what the queue publishes.
    struct Served {
        client: zbus::blocking::Connection,
        queue: Arc<Queue>,
        published: Receiver<Vec<PortalRequest>>,
        backends: Backends,
        server: zbus::blocking::Connection,
    }

    fn served(listening: bool) -> Served {
        let (backends, _) =
            Backends::new(NotificationServer::unserved(Vec::new()), Tokens::load(None));
        let (publish, published) = channel();
        backends.queue.listen(
            move |items, _| {
                let _ = publish.send(items);
            },
            move || listening,
            |parent_window| (parent_window == "wayland:abc").then(|| "app-3".to_string()),
        );
        let (server, client) = socket_pair::connected(|builder| {
            export(
                builder,
                Theme::Dark,
                Appearance::default(),
                &backends,
                Vec::new(),
                "/home/me".into(),
            )
            .expect("the interfaces registered")
        });
        Served {
            client,
            queue: Arc::clone(&backends.queue),
            published,
            backends,
            server,
        }
    }

    /// The next signal named `member` the client hears.
    #[track_caller]
    /// The next signal named `member` in `messages`. Take `messages` before
    /// whatever sends the signal: one that arrives earlier is not kept.
    fn heard(messages: &mut zbus::blocking::MessageIterator, member: &str) -> zbus::message::Body {
        messages
            .map(|message| message.expect("a message"))
            .find(|message| {
                message.message_type() == zbus::message::Type::Signal
                    && message.header().member().is_some_and(|name| name == member)
            })
            .expect("the signal")
            .body()
    }

    /// Call `AccessDialog` from another thread, returning its response.
    fn ask_for_access(client: &zbus::blocking::Connection) -> thread::JoinHandle<u32> {
        let client = client.clone();
        thread::spawn(move || {
            let options = HashMap::from([(
                "grant_label".to_string(),
                OwnedValue::try_from(Value::from("Allow")).expect("ownable"),
            )]);
            let reply = client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.Access"),
                    "AccessDialog",
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        "org.example.App",
                        "wayland:abc",
                        "Use the camera?",
                        "",
                        "",
                        options,
                    ),
                )
                .expect("AccessDialog answered");
            let (response, results): (u32, HashMap<String, OwnedValue>) =
                reply.body().deserialize().expect("its reply");
            assert!(results.is_empty());
            response
        })
    }

    #[track_caller]
    fn next(published: &Receiver<Vec<PortalRequest>>) -> Vec<PortalRequest> {
        published
            .recv_timeout(Duration::from_secs(10))
            .expect("the queue published")
    }

    #[test]
    fn an_access_dialog_waits_for_the_shell_over_its_parent_and_takes_its_answer() {
        let served = served(true);
        let asking = ask_for_access(&served.client);

        assert_eq!(
            next(&served.published),
            [PortalRequest {
                id: 1,
                app_id: "org.example.App".into(),
                parent_app_id: Some("app-3".into()),
                kind: PortalKind::Access(AccessDialog {
                    title: "Use the camera?".into(),
                    subtitle: String::new(),
                    body: String::new(),
                    grant_label: Some("Allow".into()),
                    deny_label: None,
                }),
            }]
        );
        served.queue.answer(1, PortalAnswer::Access);

        assert_eq!(asking.join().expect("the call returned"), 0);
        assert_eq!(next(&served.published), []);
    }

    #[test]
    fn a_dismissed_dialog_answers_one() {
        let served = served(true);
        let asking = ask_for_access(&served.client);
        next(&served.published);
        served.queue.answer(1, PortalAnswer::Canceled);

        assert_eq!(asking.join().expect("the call returned"), 1);
    }

    #[test]
    fn an_application_that_closes_its_request_takes_the_dialog_down() {
        let served = served(true);
        let asking = ask_for_access(&served.client);
        next(&served.published);

        served
            .client
            .call_method(
                None::<&str>,
                HANDLE,
                Some("org.freedesktop.impl.portal.Request"),
                "Close",
                &(),
            )
            .expect("Close answered");

        assert_eq!(next(&served.published), []);
        assert_eq!(asking.join().expect("the call returned"), 2);
    }

    #[test]
    fn a_dialog_nobody_listens_for_is_refused_at_once() {
        let served = served(false);

        assert_eq!(
            ask_for_access(&served.client)
                .join()
                .expect("the call returned"),
            2
        );
        assert!(
            served.published.try_iter().all(|items| items.is_empty()),
            "nothing reached the shell"
        );
    }

    /// Call `ChooseApplication` over `wayland:abc` from another thread,
    /// returning its reply. `modal` is the option, if sent.
    fn choose_application(
        client: &zbus::blocking::Connection,
        modal: Option<bool>,
    ) -> thread::JoinHandle<(u32, HashMap<String, OwnedValue>)> {
        let client = client.clone();
        thread::spawn(move || {
            let mut options = HashMap::from([
                (
                    "content_type".to_string(),
                    OwnedValue::try_from(Value::from("application/pdf")).expect("ownable"),
                ),
                (
                    "activation_token".to_string(),
                    OwnedValue::try_from(Value::from("token-1")).expect("ownable"),
                ),
            ]);
            if let Some(modal) = modal {
                options.insert(
                    "modal".to_string(),
                    OwnedValue::try_from(Value::from(modal)).expect("ownable"),
                );
            }
            client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.AppChooser"),
                    "ChooseApplication",
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        "org.example.App",
                        "wayland:abc",
                        vec!["org.gnome.Evince"],
                        options,
                    ),
                )
                .expect("ChooseApplication answered")
                .body()
                .deserialize()
                .expect("its reply")
        })
    }

    /// The dialog [`choose_application`] asks for, modal over `app-3`.
    fn pdf_dialog(choices: &[&str]) -> PortalRequest {
        PortalRequest {
            id: 1,
            app_id: "org.example.App".into(),
            parent_app_id: Some("app-3".into()),
            kind: PortalKind::AppChooser(AppChooserDialog {
                choices: choices.iter().map(|choice| choice.to_string()).collect(),
                last_choice: None,
                content_type: Some("application/pdf".into()),
                uri: None,
                filename: None,
            }),
        }
    }

    #[test]
    fn an_application_chosen_after_the_choices_change_is_answered() {
        let served = served(true);
        let choosing = choose_application(&served.client, None);
        assert_eq!(next(&served.published), [pdf_dialog(&["org.gnome.Evince"])]);

        served
            .client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.freedesktop.impl.portal.AppChooser"),
                "UpdateChoices",
                &(
                    ObjectPath::try_from(HANDLE).expect("a path"),
                    vec!["org.gnome.Evince", "org.gnome.Papers"],
                ),
            )
            .expect("UpdateChoices answered");
        assert_eq!(
            next(&served.published),
            [pdf_dialog(&["org.gnome.Evince", "org.gnome.Papers"])]
        );
        served.queue.answer(
            1,
            PortalAnswer::AppChooser {
                choice: "org.gnome.Papers".into(),
            },
        );

        let (response, results) = choosing.join().expect("the call returned");
        assert_eq!(response, 0);
        assert_eq!(
            results,
            HashMap::from([
                (
                    "choice".to_string(),
                    OwnedValue::try_from(Value::from("org.gnome.Papers")).expect("ownable"),
                ),
                (
                    "activation_token".to_string(),
                    OwnedValue::try_from(Value::from("token-1")).expect("ownable"),
                ),
            ])
        );
    }

    #[test]
    fn a_dialog_that_need_not_be_modal_goes_over_the_focused_screen() {
        let served = served(true);
        let choosing = choose_application(&served.client, Some(false));

        assert_eq!(
            next(&served.published),
            [PortalRequest {
                parent_app_id: None,
                ..pdf_dialog(&["org.gnome.Evince"])
            }]
        );
        served.queue.answer(1, PortalAnswer::Canceled);
        choosing.join().expect("the call returned");
    }

    #[test]
    fn a_choice_that_was_not_offered_is_not_taken() {
        let served = served(true);
        let choosing = choose_application(&served.client, None);
        next(&served.published);

        served.queue.answer(
            1,
            PortalAnswer::AppChooser {
                choice: "org.example.Evil".into(),
            },
        );
        assert_eq!(next(&served.published).len(), 1, "still waiting");
        served.queue.answer(1, PortalAnswer::Canceled);

        let (response, results) = choosing.join().expect("the call returned");
        assert_eq!((response, results.len()), (1, 0));
    }

    /// The notifications the server's history holds after `act`.
    fn shown_after(served: &Served, act: impl FnOnce()) -> Vec<Shown> {
        act();
        let (publish, published) = channel();
        served.backends.notifications.listen(move |items| {
            let _ = publish.send(items);
        });
        published.recv().expect("the history")
    }

    #[test]
    fn a_portal_notification_joins_the_history_and_its_action_goes_back() {
        let served = served(true);
        let add = || {
            let notification = HashMap::from([
                ("title", Value::from("Update")),
                ("default-action", Value::from("app.open")),
                ("default-action-target", Value::from("inbox")),
            ]);
            served
                .client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.Notification"),
                    "AddNotification",
                    &("org.example.App", "update", notification),
                )
                .expect("AddNotification answered");
        };

        let shown = shown_after(&served, add);
        let mut messages = zbus::blocking::MessageIterator::from(&served.client);
        let iface = served
            .server
            .object_server()
            .interface::<_, Notification>(OBJECT_PATH)
            .expect("served");
        notification::invoked(
            &iface,
            Invoked {
                app_id: "org.example.App".into(),
                id: "update".into(),
                action: "app.open".into(),
                target: Some(OwnedValue::try_from(Value::from("inbox")).expect("ownable")),
            },
        );

        assert_eq!(
            shown
                .iter()
                .map(|shown| (shown.summary.as_str(), shown.clickable))
                .collect::<Vec<_>>(),
            [("Update", true)]
        );
        let (app_id, id, action, parameter): (String, String, String, Vec<OwnedValue>) =
            heard(&mut messages, "ActionInvoked")
                .deserialize()
                .expect("ActionInvoked's arguments");
        assert_eq!(
            (app_id.as_str(), id.as_str(), action.as_str()),
            ("org.example.App", "update", "app.open")
        );
        assert_eq!(
            parameter
                .into_iter()
                .map(String::try_from)
                .collect::<Vec<_>>(),
            [Ok("inbox".to_string())]
        );
    }

    #[test]
    fn an_application_removes_its_portal_notification() {
        let served = served(true);
        served
            .client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.freedesktop.impl.portal.Notification"),
                "AddNotification",
                &(
                    "org.example.App",
                    "update",
                    HashMap::from([("title", Value::from("Update"))]),
                ),
            )
            .expect("AddNotification answered");

        let shown = shown_after(&served, || {
            served
                .client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.Notification"),
                    "RemoveNotification",
                    &("org.example.App", "update"),
                )
                .expect("RemoveNotification answered");
        });

        assert_eq!(shown, []);
    }

    /// The handle an application's inhibitor is held under.
    const INHIBITOR: &str = "/org/freedesktop/portal/desktop/request/1_7/i";

    #[test]
    fn an_inhibitor_is_listed_and_holds_idle_until_closed() {
        let served = served(false);
        let (told, held) = channel();
        served
            .backends
            .inhibitors
            .hold_idle_through(move |holds| told.send(holds).expect("the test listens"));

        served
            .client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.freedesktop.impl.portal.Inhibit"),
                "Inhibit",
                &(
                    ObjectPath::try_from(INHIBITOR).expect("a path"),
                    "org.example.Editor",
                    "",
                    1u32 | 8,
                    HashMap::from([("reason", Value::from("Unsaved changes"))]),
                ),
            )
            .expect("Inhibit answered");
        let listed = next(&served.published);
        served
            .client
            .call_method(
                None::<&str>,
                INHIBITOR,
                Some("org.freedesktop.impl.portal.Request"),
                "Close",
                &(),
            )
            .expect("Close answered");

        assert_eq!(
            listed,
            [PortalRequest {
                id: 1,
                app_id: "org.example.Editor".into(),
                parent_app_id: None,
                kind: PortalKind::Inhibit(Inhibition {
                    what: vec![Inhibited::Logout],
                    reason: Some("Unsaved changes".into()),
                }),
            }]
        );
        assert_eq!(next(&served.published), []);
        assert_eq!(held.try_iter().collect::<Vec<_>>(), [true, false]);
    }

    /// Open a monitor at `session`.
    fn monitor(client: &zbus::blocking::Connection, session: &str) -> u32 {
        client
            .call_method(
                None::<&str>,
                OBJECT_PATH,
                Some("org.freedesktop.impl.portal.Inhibit"),
                "CreateMonitor",
                &(
                    ObjectPath::try_from(INHIBITOR).expect("a path"),
                    ObjectPath::try_from(session).expect("a path"),
                    "org.example.Player",
                    "",
                ),
            )
            .expect("CreateMonitor answered")
            .body()
            .deserialize()
            .expect("a response")
    }

    #[test]
    fn a_monitor_hears_the_screensaver_until_it_is_closed() {
        const GONE: &str = "/org/freedesktop/portal/desktop/session/1_7/gone";
        const STAYING: &str = "/org/freedesktop/portal/desktop/session/1_7/staying";
        let served = served(true);
        let inhibit = served
            .server
            .object_server()
            .interface::<_, Inhibit>(OBJECT_PATH)
            .expect("served");
        let responses = [
            monitor(&served.client, GONE),
            monitor(&served.client, STAYING),
        ];
        served
            .client
            .call_method(
                None::<&str>,
                GONE,
                Some("org.freedesktop.impl.portal.Session"),
                "Close",
                &(),
            )
            .expect("Close answered");

        let mut messages = zbus::blocking::MessageIterator::from(&served.client);
        inhibit::screensaver(&inhibit, true).expect("said");

        assert_eq!(responses, [0, 0]);
        // The closed monitor would have been told first.
        let (session, state): (OwnedObjectPath, HashMap<String, OwnedValue>) =
            heard(&mut messages, "StateChanged")
                .deserialize()
                .expect("StateChanged's arguments");
        assert_eq!(session.as_str(), STAYING);
        assert_eq!(bool::try_from(&state["screensaver-active"]), Ok(true));
        assert_eq!(u32::try_from(&state["session-state"]), Ok(1));
    }

    #[test]
    fn a_new_look_is_signaled_to_clients() {
        let served = served(true);
        let settings = served
            .server
            .object_server()
            .interface::<_, Settings>(OBJECT_PATH)
            .expect("served");
        let mut messages = zbus::blocking::MessageIterator::from(&served.client);

        settings::changed(
            &settings,
            None,
            Some(Appearance {
                reduced_motion: true,
                ..Appearance::default()
            }),
        )
        .expect("said");

        let (namespace, key, value): (String, String, OwnedValue) =
            heard(&mut messages, "SettingChanged")
                .deserialize()
                .expect("SettingChanged's arguments");
        assert_eq!(
            (namespace.as_str(), key.as_str(), u32::try_from(value)),
            ("org.freedesktop.appearance", "reduced-motion", Ok(1))
        );
    }

    #[test]
    fn a_file_chooser_waits_for_the_shell_and_answers_with_file_uris() {
        let served = served(true);
        let client = served.client.clone();
        let asking = thread::spawn(move || {
            let options = HashMap::from([(
                "multiple".to_string(),
                OwnedValue::try_from(Value::from(true)).expect("ownable"),
            )]);
            let reply = client
                .call_method(
                    None::<&str>,
                    OBJECT_PATH,
                    Some("org.freedesktop.impl.portal.FileChooser"),
                    "OpenFile",
                    &(
                        ObjectPath::try_from(HANDLE).expect("a path"),
                        "org.example.Editor",
                        "",
                        "Open Notes",
                        options,
                    ),
                )
                .expect("OpenFile answered");
            let (response, results): (u32, HashMap<String, OwnedValue>) =
                reply.body().deserialize().expect("its reply");
            (
                response,
                Vec::<String>::try_from(results["uris"].try_clone().expect("cloned"))
                    .expect("uris"),
            )
        });

        let [request] = &next(&served.published)[..] else {
            panic!("one request");
        };
        let PortalKind::FileChooser(dialog) = &request.kind else {
            panic!("a file chooser: {request:?}");
        };
        assert_eq!(
            (dialog.title.as_str(), dialog.multiple),
            ("Open Notes", true)
        );
        served.queue.answer(
            request.id,
            PortalAnswer::FileChooser(FileChooserAnswer {
                paths: vec!["/home/me/a.txt".into(), "/home/me/b.txt".into()],
                choices: Default::default(),
                current_filter: None,
            }),
        );

        assert_eq!(
            asking.join().expect("the call returned"),
            (
                0,
                vec![
                    "file:///home/me/a.txt".to_string(),
                    "file:///home/me/b.txt".to_string()
                ]
            )
        );
    }

    #[test]
    fn a_desk_that_is_the_session_is_where_activated_apps_open() {
        // Activated apps open on the `WAYLAND_DISPLAY` in the activation
        // environment, which another session may have set.
        assert_eq!(
            activation_environment("wayland-1", None),
            [
                ("XDG_CURRENT_DESKTOP", CURRENT_DESKTOP.to_string()),
                ("WAYLAND_DISPLAY", "wayland-1".to_string()),
            ]
        );
    }

    #[test]
    fn a_desk_in_a_window_leaves_its_sessions_activation_environment_alone() {
        // The outer session owns its activated apps and portal routing.
        assert_eq!(
            activation_environment("wayland-1", Some(OsStr::new("wayland-0"))),
            []
        );
    }

    #[test]
    fn an_empty_display_is_no_session() {
        // As in `domicile_launch::platform`, an empty `WAYLAND_DISPLAY` means
        // the drm platform, so this desk is the session.
        assert_eq!(
            activation_environment("wayland-1", Some(OsStr::new(""))),
            activation_environment("wayland-1", None)
        );
    }
}
