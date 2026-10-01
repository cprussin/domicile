//! Notifications: this compositor is the desk's notification server.
//!
//! **`org.freedesktop.Notifications` is how every application on a Linux
//! desktop says something happened** — `notify-send`, GTK and Qt, Electron,
//! and the browser itself: Chrome on Linux shows a page's Web Notification by
//! calling this same server, so a site in a `<webview>` and a Wayland client
//! arrive here the same way. A desktop's notification daemon is normally a
//! program of its own; here the drawing is the shell's, and the shell is a
//! page with no bus, so this process owns the name and tells every chrome the
//! desk's notifications as a
//! [`HostMessage::Notifications`](domicile_protocol::HostMessage::Notifications).
//! A press on one comes back as `invoke_notification_action`, a clear as
//! `dismiss_notifications`, and the application hears `ActionInvoked` and
//! `NotificationClosed`.
//!
//! What a notification is *shown as*, and the history of them, is
//! `domicile_host::notifications`, which is pure and tested there. This is the
//! bus, and nothing else.
//!
//! **`Notify` is answered on the bus's own executor**, unlike the tray's
//! work: it has to return the id, and taking up a notification waits on
//! nothing but the store's lock and, at worst, reading one icon file. A
//! shell's dismissals and presses go to a worker instead, which says the
//! signals.
//!
//! **Nothing here can take the desktop down**, for [`crate::tray`]'s reason:
//! a desk with no session bus, or one inside a session whose own daemon holds
//! the name, has no notifications, and the log says why once.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use domicile_host::notifications::{Hints, Image, Notifications, Notify};
use domicile_host::tray::TrayIcons;
use domicile_protocol::Notification;
use tracing::{debug, warn};
use zbus::blocking::object_server::InterfaceRef;
use zbus::blocking::Connection;
use zbus::zvariant::OwnedValue;
use zbus::SignalContext;

/// The name a notification server answers on.
const SERVER_NAME: &str = "org.freedesktop.Notifications";

/// Where it answers.
const SERVER_PATH: &str = "/org/freedesktop/Notifications";

/// What this server can do, as `GetCapabilities` says it.
///
/// **No `body-markup`.** A body is drawn as text, and a sender that is told
/// the server takes no markup sends none — the browser among them, which
/// otherwise escapes a page's text into markup for a server to parse back.
/// `persistence` is the drawer: a notification stays until it is cleared.
/// `x-kde-origin-name` is KDE's, and the browser looks for it: a server that
/// takes it is told the site a Web Notification came from as a hint, rather
/// than as a line written into the top of the body.
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
    /// Let go of to make room in the history.
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
}

/// A handle on the server: tell it what the user did and the applications
/// hear about it.
///
/// [`crate::tray::Tray`]'s shape and for its reason: a desk whose server never
/// started holds one of these that goes nowhere.
#[derive(Debug, Clone)]
pub struct NotificationServer {
    told: Sender<Event>,
}

impl NotificationServer {
    /// The user cleared `ids`.
    pub fn dismiss(&self, ids: Vec<u32>) {
        // A closed channel is a worker that has stopped, which it does only
        // after saying why.
        let _ = self.told.send(Event::Dismiss { ids });
    }

    /// The user pressed `action` on `id`.
    pub fn invoke(&self, id: u32, action: String) {
        let _ = self.told.send(Event::Invoke { id, action });
    }
}

/// Start being the desk's notification server, calling `publish` with the
/// notifications whenever they change. Icons are looked for under
/// `data_dirs`.
///
/// Returns as soon as the thread is spawned, for [`crate::tray::serve`]'s
/// reason.
pub fn serve(
    data_dirs: Vec<PathBuf>,
    publish: impl Fn(Vec<Notification>) + Send + Sync + 'static,
) -> NotificationServer {
    let (told, events) = channel();
    thread::spawn(move || {
        let store = Store {
            held: Mutex::new(Notifications::new(TrayIcons::new(data_dirs))),
            publish: Box::new(publish),
        };
        if let Err(why) = answer(Arc::new(store), &events) {
            warn!(
                %why,
                "this desktop is not the notification server; its applications' \
                 notifications will not be shown"
            );
        }
    });
    NotificationServer { told }
}

/// The notifications, and who is told when they change.
struct Store {
    held: Mutex<Notifications>,
    publish: Box<dyn Fn(Vec<Notification>) + Send + Sync>,
}

impl Store {
    /// Change the notifications with `change`, and publish what they are
    /// after it — under the lock, so two changes are published in the order
    /// they were made.
    fn change<T>(&self, change: impl FnOnce(&mut Notifications) -> T) -> T {
        let mut held = self.held.lock().unwrap();
        let changed = change(&mut held);
        (self.publish)(held.items());
        changed
    }
}

/// Serve the name, and do each of the user's events in turn. Returns only on
/// failure, or when the compositor has gone.
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
    // Ends when every sender has gone, which is the compositor exiting.
    for event in events {
        match event {
            Event::Dismiss { ids } => {
                for id in store.change(|held| held.dismiss(&ids)) {
                    closed(&server, id, Reason::Dismissed);
                }
            }
            Event::Invoke { id, action } => match store.change(|held| held.invoke(id, &action)) {
                Some(closes) => {
                    invoked(&server, id, &action);
                    if closes {
                        closed(&server, id, Reason::Dismissed);
                    }
                }
                None => debug!(%id, %action, "an action on a notification that does not offer it"),
            },
        }
    }
    Ok(())
}

/// Say `NotificationClosed`. A failure is said and gone past, for
/// `crate::tray::listed`'s reason.
fn closed(server: &InterfaceRef<Server>, id: u32, reason: Reason) {
    let said = zbus::block_on(Server::notification_closed(
        server.signal_context(),
        id,
        reason as u32,
    ));
    if let Err(why) = said {
        warn!(%why, %id, "a notification's closing could not be said");
    }
}

/// Say `ActionInvoked`.
fn invoked(server: &InterfaceRef<Server>, id: u32, action: &str) {
    let said = zbus::block_on(Server::action_invoked(server.signal_context(), id, action));
    if let Err(why) = said {
        warn!(%why, %id, "a notification's action could not be said");
    }
}

/// Milliseconds since the epoch, which is what a shell says "two minutes ago"
/// from.
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the clock is after 1970")
        .as_millis() as u64
}

/// The hints a `Notify` carries, as [`Hints`]. A hint left out, or sent as
/// something the spec does not say it is, is read as absent; the ones a shell
/// has no use for are dropped.
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

    /// A notification, which is held, published, and answered with its id.
    /// One let go of to make room is said to have expired.
    #[allow(clippy::too_many_arguments)] // The spec's own signature.
    async fn notify(
        &self,
        #[zbus(signal_context)] context: SignalContext<'_>,
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
        };
        let notified = self.store.change(|held| held.notify(sent, now()));
        if let Some(evicted) = notified.evicted {
            if let Err(why) =
                Self::notification_closed(&context, evicted, Reason::Expired as u32).await
            {
                warn!(%why, "a notification's closing could not be said");
            }
        }
        notified.id
    }

    /// The application taking its notification down. One already gone is
    /// nothing to say.
    async fn close_notification(
        &self,
        #[zbus(signal_context)] context: SignalContext<'_>,
        id: u32,
    ) {
        if self.store.change(|held| held.close(id)) {
            if let Err(why) = Self::notification_closed(&context, id, Reason::Closed as u32).await {
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
        context: &SignalContext<'_>,
        id: u32,
        reason: u32,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn action_invoked(
        context: &SignalContext<'_>,
        id: u32,
        action_key: &str,
    ) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use zbus::zvariant::Value;

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
