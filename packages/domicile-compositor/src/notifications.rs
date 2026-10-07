//! The desktop's `org.freedesktop.Notifications` server.
//!
//! Linux applications send notifications over this D-Bus interface, and so
//! does Chromium for a page's Web Notifications. The shell is a page with no
//! bus access, so this process owns the name and sends the notifications to
//! every chrome as
//! [`HostMessage::Notifications`](domicile_protocol::HostMessage::Notifications).
//! Presses and clears come back as `invoke_notification_action` and
//! `dismiss_notifications`, and the application gets `ActionInvoked` and
//! `NotificationClosed`. See `docs/architecture/NOTIFICATIONS.md`.
//!
//! The notification model is in `domicile_host::notifications`; this module
//! is only the bus. The notification portal (`crate::portals`) adds to the same
//! history through [`NotificationServer::add_from_portal`].
//!
//! `Notify` runs on the bus executor because it must return the id, and it
//! waits only on the store lock and at most one icon read. Dismissals and
//! presses go to a worker thread, which emits the signals.
//!
//! Failure is not fatal, as with [`crate::tray`]: with no session bus, or
//! another daemon holding the name, the desktop has no notifications and logs
//! why once.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use domicile_host::notifications::{Hints, Image, Notifications, Notified, Notify};
use domicile_host::portal_notifications::{Invoked, PortalNotification, PortalNotifications};
use domicile_host::tray::TrayIcons;
use domicile_protocol::Notification;
use tracing::{debug, warn};
use zbus::blocking::object_server::InterfaceRef;
use zbus::blocking::Connection;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::OwnedValue;

/// The name a notification server answers on.
const SERVER_NAME: &str = "org.freedesktop.Notifications";

/// Where it answers.
const SERVER_PATH: &str = "/org/freedesktop/Notifications";

/// The capabilities `GetCapabilities` reports.
///
/// - No `body-markup`: bodies are drawn as plain text, and senders such as
///   Chromium then send no markup.
/// - `persistence`: a notification stays until it is cleared.
/// - `x-kde-origin-name`: Chromium then sends a Web Notification's site as a
///   hint instead of prepending it to the body.
const CAPABILITIES: &[&str] = &[
    "actions",
    "body",
    "icon-static",
    "persistence",
    "x-kde-origin-name",
];

/// The version of the spec this server answers to.
const SPEC_VERSION: &str = "1.2";

/// Why a notification closed, as `NotificationClosed` numbers the reasons.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reason {
    /// Evicted to make room in the history.
    Expired = 1,
    /// The user cleared it, or took one of its actions.
    Dismissed = 2,
    /// Its application closed it.
    Closed = 3,
}

/// Something the worker has to do.
enum Event {
    /// The user cleared these.
    Dismiss { ids: Vec<u32> },
    /// The user pressed `action` on `id`.
    Invoke { id: u32, action: String },
    /// A portal notification pushed this one out of the history.
    Expired { id: u32 },
}

/// A handle for passing user actions on to the applications, and portal
/// notifications into the history.
///
/// As with [`crate::tray::Tray`], user actions do nothing if the server never
/// started.
#[derive(Clone)]
pub struct NotificationServer {
    told: Sender<Event>,
    store: Arc<Store>,
}

impl NotificationServer {
    /// A server with no bus, for unit tests.
    #[cfg(test)]
    pub fn unserved(data_dirs: Vec<PathBuf>) -> Self {
        let (told, _) = channel();
        NotificationServer {
            told,
            store: Arc::new(Store::new(data_dirs)),
        }
    }

    /// Call `publish` with the notifications now and whenever they change.
    pub fn listen(&self, publish: impl Fn(Vec<Notification>) + Send + Sync + 'static) {
        let held = self.store.held.lock().unwrap();
        publish(held.notifications.items());
        if self.store.publish.set(Box::new(publish)).is_err() {
            panic!("the notifications have one listener");
        }
    }

    /// The user cleared `ids`.
    pub fn dismiss(&self, ids: Vec<u32>) {
        // Fails only once the worker has stopped and logged why.
        let _ = self.told.send(Event::Dismiss { ids });
    }

    /// The user pressed `action` on `id`.
    pub fn invoke(&self, id: u32, action: String) {
        let _ = self.told.send(Event::Invoke { id, action });
    }

    /// Add or replace `app_id`'s notification `id`, from the notification
    /// portal.
    pub fn add_from_portal(
        &self,
        app_id: String,
        id: String,
        notification: PortalNotification<OwnedValue>,
    ) {
        let notified = self.store.change(|held| {
            let notified =
                held.portal
                    .add(&mut held.notifications, app_id, id, notification, now());
            (
                notified,
                notified
                    .evicted
                    .is_some_and(|evicted| held.portal.forget(evicted)),
            )
        });
        if let (
            Notified {
                evicted: Some(id), ..
            },
            false,
        ) = notified
        {
            let _ = self.told.send(Event::Expired { id });
        }
    }

    /// Remove `app_id`'s notification `id`, if held.
    pub fn remove_from_portal(&self, app_id: &str, id: &str) {
        self.store
            .change(|held| held.portal.remove(&mut held.notifications, app_id, id));
    }

    /// Call `invoked` with each action the user takes on a portal
    /// notification.
    pub fn on_portal_action(&self, invoked: impl Fn(Invoked<OwnedValue>) + Send + Sync + 'static) {
        if self.store.portal_actions.set(Box::new(invoked)).is_err() {
            panic!("portal notifications have one listener");
        }
    }
}

/// Start the notification server. Icons are looked up under `data_dirs`.
///
/// Returns once the thread is spawned, like [`crate::tray::serve`].
/// [`NotificationServer::listen`] says where the notifications go.
pub fn serve(data_dirs: Vec<PathBuf>) -> NotificationServer {
    let (told, events) = channel();
    let store = Arc::new(Store::new(data_dirs));
    let serving = Arc::clone(&store);
    thread::spawn(move || {
        if let Err(why) = answer(serving, &events) {
            warn!(
                %why,
                "this desktop is not the notification server; its applications' \
                 notifications will not be shown"
            );
        }
    });
    NotificationServer { told, store }
}

/// The notifications, and who is told when they change.
struct Store {
    held: Mutex<Held>,
    publish: OnceLock<Box<dyn Fn(Vec<Notification>) + Send + Sync>>,
    portal_actions: OnceLock<Box<dyn Fn(Invoked<OwnedValue>) + Send + Sync>>,
}

/// The history, and which of it the portal added.
struct Held {
    notifications: Notifications,
    portal: PortalNotifications<OwnedValue>,
}

/// What a press on a notification did.
enum Pressed {
    /// `ActionInvoked` goes to the bus, and `NotificationClosed` if it closes.
    Bus {
        closes: bool,
    },
    /// `ActionInvoked` goes to the portal.
    Portal(Invoked<OwnedValue>),
    NotOffered,
}

impl Store {
    fn new(data_dirs: Vec<PathBuf>) -> Self {
        Store {
            held: Mutex::new(Held {
                notifications: Notifications::new(TrayIcons::new(data_dirs)),
                portal: PortalNotifications::default(),
            }),
            publish: OnceLock::new(),
            portal_actions: OnceLock::new(),
        }
    }

    /// Apply `change` and publish the result. Publishing under the lock keeps
    /// changes in order.
    fn change<T>(&self, change: impl FnOnce(&mut Held) -> T) -> T {
        let mut held = self.held.lock().unwrap();
        let changed = change(&mut held);
        if let Some(publish) = self.publish.get() {
            publish(held.notifications.items());
        }
        changed
    }

    /// Clear `ids`. Returns the held ones the bus sent, in the order given.
    fn dismiss(&self, ids: &[u32]) -> Vec<u32> {
        self.change(|held| {
            let dismissed = held.notifications.dismiss(ids);
            dismissed
                .into_iter()
                .filter(|id| !held.portal.forget(*id))
                .collect()
        })
    }

    /// Press `action` on `id`.
    fn press(&self, id: u32, action: &str) -> Pressed {
        self.change(|held| {
            if held.portal.owns(id) {
                held.portal
                    .invoke(&mut held.notifications, id, action)
                    .map_or(Pressed::NotOffered, Pressed::Portal)
            } else {
                held.notifications
                    .invoke(id, action)
                    .map_or(Pressed::NotOffered, |closes| Pressed::Bus { closes })
            }
        })
    }
}

/// Serve the name and handle user events in order. Returns on failure or
/// when the compositor exits.
fn answer(store: Arc<Store>, events: &Receiver<Event>) -> zbus::Result<()> {
    let connection = Connection::session()?;
    connection.object_server().at(
        SERVER_PATH,
        Server {
            store: Arc::clone(&store),
        },
    )?;
    connection.request_name(SERVER_NAME)?;
    debug!("this desktop is the notification server");

    let server = connection
        .object_server()
        .interface::<_, Server>(SERVER_PATH)?;
    // Ends when the compositor exits and drops every sender.
    for event in events {
        match event {
            Event::Dismiss { ids } => {
                for id in store.dismiss(&ids) {
                    closed(&server, id, Reason::Dismissed);
                }
            }
            Event::Invoke { id, action } => match store.press(id, &action) {
                Pressed::Bus { closes } => {
                    invoked(&server, id, &action);
                    if closes {
                        closed(&server, id, Reason::Dismissed);
                    }
                }
                Pressed::Portal(pressed) => match store.portal_actions.get() {
                    Some(portal) => portal(pressed),
                    None => warn!(%id, "a portal notification's action has no portal to go to"),
                },
                Pressed::NotOffered => {
                    debug!(%id, %action, "an action on a notification that does not offer it")
                }
            },
            Event::Expired { id } => closed(&server, id, Reason::Expired),
        }
    }
    Ok(())
}

/// Emit `NotificationClosed`. A failure is logged and ignored, as in
/// `crate::tray::listed`.
fn closed(server: &InterfaceRef<Server>, id: u32, reason: Reason) {
    let said = zbus::block_on(Server::notification_closed(
        server.signal_emitter(),
        id,
        reason as u32,
    ));
    if let Err(why) = said {
        warn!(%why, %id, "a notification's closing could not be said");
    }
}

/// Emit `ActionInvoked`.
fn invoked(server: &InterfaceRef<Server>, id: u32, action: &str) {
    let said = zbus::block_on(Server::action_invoked(server.signal_emitter(), id, action));
    if let Err(why) = said {
        warn!(%why, %id, "a notification's action could not be said");
    }
}

/// Milliseconds since the epoch, which shells use for relative times.
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the clock is after 1970")
        .as_millis() as u64
}

/// Parse a `Notify`'s hints. A missing or mistyped hint reads as absent;
/// hints the shell does not use are dropped.
fn hints(mut sent: HashMap<String, OwnedValue>) -> Hints {
    let mut first = |names: &[&str]| names.iter().find_map(|name| sent.remove(*name));
    let urgency = first(&["urgency"]).and_then(|value| u8::try_from(value).ok());
    // `image-data` since 1.2, `image_data` in 1.1, `icon_data` before that.
    let image_data = first(&["image-data", "image_data", "icon_data"])
        .and_then(|value| <(i32, i32, i32, bool, i32, i32, Vec<u8>)>::try_from(value).ok())
        .map(
            |(width, height, rowstride, has_alpha, bits_per_sample, channels, data)| Image {
                width,
                height,
                rowstride,
                has_alpha,
                bits_per_sample,
                channels,
                data,
            },
        );
    let image_path =
        first(&["image-path", "image_path"]).and_then(|value| String::try_from(value).ok());
    let resident = first(&["resident"])
        .and_then(|value| bool::try_from(value).ok())
        .unwrap_or(false);
    let origin_name = first(&["x-kde-origin-name"]).and_then(|value| String::try_from(value).ok());
    Hints {
        urgency,
        image_data,
        image_path,
        resident,
        origin_name,
    }
}

/// The object at `/org/freedesktop/Notifications`.
struct Server {
    store: Arc<Store>,
}

#[zbus::interface(name = "org.freedesktop.Notifications")]
impl Server {
    fn get_capabilities(&self) -> Vec<String> {
        CAPABILITIES
            .iter()
            .map(|capability| capability.to_string())
            .collect()
    }

    /// Store and publish a notification and return its id. A notification
    /// evicted to make room is reported as expired.
    #[allow(clippy::too_many_arguments)] // The spec's own signature.
    async fn notify(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        app_name: String,
        replaces_id: u32,
        app_icon: String,
        summary: String,
        body: String,
        actions: Vec<String>,
        hints: HashMap<String, OwnedValue>,
        expire_timeout: i32,
    ) -> u32 {
        let sent = Notify {
            app_name,
            replaces_id,
            app_icon,
            summary,
            body,
            actions,
            hints: self::hints(hints),
            expire_timeout,
            icon: None,
        };
        let notified = self.store.change(|held| {
            let notified = held.notifications.notify(sent, now());
            Notified {
                evicted: notified
                    .evicted
                    .filter(|evicted| !held.portal.forget(*evicted)),
                ..notified
            }
        });
        if let Some(evicted) = notified.evicted {
            if let Err(why) =
                Self::notification_closed(&emitter, evicted, Reason::Expired as u32).await
            {
                warn!(%why, "a notification's closing could not be said");
            }
        }
        notified.id
    }

    /// The application closing its notification. Closing one already gone
    /// emits nothing.
    async fn close_notification(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        id: u32,
    ) {
        if self.store.change(|held| held.notifications.close(id)) {
            if let Err(why) = Self::notification_closed(&emitter, id, Reason::Closed as u32).await {
                warn!(%why, "a notification's closing could not be said");
            }
        }
    }

    /// Name, vendor, version and the spec's version.
    fn get_server_information(&self) -> (String, String, String, String) {
        (
            "Domicile".to_string(),
            "Domicile".to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
            SPEC_VERSION.to_string(),
        )
    }

    #[zbus(signal)]
    async fn notification_closed(
        emitter: &SignalEmitter<'_>,
        id: u32,
        reason: u32,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn action_invoked(
        emitter: &SignalEmitter<'_>,
        id: u32,
        action_key: &str,
    ) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_host::portal_notifications::{Action, Priority};
    use zbus::zvariant::Value;

    /// A server with no bus, and what it publishes.
    fn unserved() -> (NotificationServer, Receiver<Vec<Notification>>) {
        let server = NotificationServer::unserved(Vec::new());
        let (publish, published) = channel();
        server.listen(move |items| {
            let _ = publish.send(items);
        });
        (server, published)
    }

    fn from_the_portal(title: &str) -> PortalNotification<OwnedValue> {
        PortalNotification {
            title: title.into(),
            body: String::new(),
            icon: None,
            priority: Priority::Normal,
            default_action: Some(Action {
                name: "app.open".into(),
                target: Some(OwnedValue::from(7u32)),
            }),
            buttons: Vec::new(),
            display_hint: Vec::new(),
        }
    }

    fn bus_notify(summary: &str) -> Notify {
        Notify {
            app_name: "Firefox".into(),
            summary: summary.into(),
            actions: vec!["default".into(), String::new()],
            expire_timeout: -1,
            ..Notify::default()
        }
    }

    #[test]
    fn listening_publishes_what_arrived_before() {
        let server = NotificationServer::unserved(Vec::new());
        server.add_from_portal(
            "org.example.App".into(),
            "update".into(),
            from_the_portal("Update"),
        );
        let (publish, published) = channel();

        server.listen(move |items| {
            let _ = publish.send(items);
        });

        assert_eq!(published.try_recv().map(|items| items.len()), Ok(1));
    }

    #[test]
    fn a_portal_notification_is_pressed_through_the_portal() {
        let (server, _published) = unserved();
        let bus = server
            .store
            .change(|held| held.notifications.notify(bus_notify("Mail"), 0).id);
        server.add_from_portal(
            "org.example.App".into(),
            "update".into(),
            from_the_portal("Update"),
        );
        let portal = bus + 1;

        assert!(matches!(
            server.store.press(bus, "default"),
            Pressed::Bus { closes: true }
        ));
        assert!(matches!(
            server.store.press(bus, "default"),
            Pressed::NotOffered
        ));
        match server.store.press(portal, "default") {
            Pressed::Portal(invoked) => {
                assert_eq!(
                    (
                        invoked.app_id.as_str(),
                        invoked.id.as_str(),
                        invoked.action.as_str()
                    ),
                    ("org.example.App", "update", "app.open")
                );
                assert_eq!(invoked.target.map(u32::try_from), Some(Ok(7)));
            }
            _ => panic!("the portal's notification went elsewhere"),
        }
    }

    #[test]
    fn clearing_closes_only_the_buses_own() {
        // A portal notification has no `NotificationClosed` to send.
        let (server, published) = unserved();
        let bus = server
            .store
            .change(|held| held.notifications.notify(bus_notify("Mail"), 0).id);
        server.add_from_portal(
            "org.example.App".into(),
            "update".into(),
            from_the_portal("Update"),
        );

        assert_eq!(server.store.dismiss(&[bus, bus + 1]), [bus]);
        assert_eq!(published.try_iter().last(), Some(Vec::new()));
        assert!(!server.store.held.lock().unwrap().portal.owns(bus + 1));
    }

    #[test]
    fn an_application_removes_its_own_portal_notification() {
        let (server, published) = unserved();
        server.add_from_portal(
            "org.example.App".into(),
            "update".into(),
            from_the_portal("Update"),
        );

        server.remove_from_portal("org.example.Other", "update");
        assert_eq!(
            published.try_iter().last().map(|items| items.len()),
            Some(1)
        );
        server.remove_from_portal("org.example.App", "update");
        assert_eq!(published.try_iter().last(), Some(Vec::new()));
    }

    /// `hints` as a `Notify` sends them.
    fn sent(hints: Vec<(&str, Value<'static>)>) -> HashMap<String, OwnedValue> {
        hints
            .into_iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    OwnedValue::try_from(value).expect("an ownable value"),
                )
            })
            .collect()
    }

    fn pixels() -> (i32, i32, i32, bool, i32, i32, Vec<u8>) {
        (1, 1, 4, true, 8, 4, vec![255, 0, 0, 255])
    }

    fn image() -> Image {
        Image {
            width: 1,
            height: 1,
            rowstride: 4,
            has_alpha: true,
            bits_per_sample: 8,
            channels: 4,
            data: vec![255, 0, 0, 255],
        }
    }

    #[test]
    fn what_a_notification_hints_is_read() {
        let read = hints(sent(vec![
            ("urgency", Value::from(2u8)),
            ("image-data", Value::from(pixels())),
            ("image-path", Value::from("/tmp/chrome-icon")),
            ("resident", Value::from(true)),
            ("x-kde-origin-name", Value::from("chat.example.com")),
            ("desktop-entry", Value::from("firefox")),
        ]));

        assert_eq!(
            read,
            Hints {
                urgency: Some(2),
                image_data: Some(image()),
                image_path: Some("/tmp/chrome-icon".into()),
                resident: true,
                origin_name: Some("chat.example.com".into()),
            }
        );
    }

    #[test]
    fn the_older_spellings_of_the_picture_are_read() {
        for name in ["image_data", "icon_data"] {
            let read = hints(sent(vec![(name, Value::from(pixels()))]));
            assert_eq!(read.image_data, Some(image()), "{name}");
        }
        let read = hints(sent(vec![("image_path", Value::from("firefox"))]));
        assert_eq!(read.image_path, Some("firefox".into()));
    }

    #[test]
    fn a_hint_of_the_wrong_type_is_absent() {
        let read = hints(sent(vec![
            ("urgency", Value::from("critical")),
            ("resident", Value::from(1u32)),
            ("image-data", Value::from(7u32)),
        ]));

        assert_eq!(read, Hints::default());
    }
}
