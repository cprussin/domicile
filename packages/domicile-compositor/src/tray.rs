//! The system tray: this compositor is the desk's StatusNotifierItem host.
//!
//! **StatusNotifierItem is the tray there is on Wayland.** The X11 tray embeds
//! an icon's window in the panel's, which a Wayland client has no way to do;
//! what every toolkit speaks instead — Qt, libappindicator for GTK, Electron —
//! is an object on the session bus that describes its icon, and a
//! *watcher* the items register with. A desktop's panel is normally both the
//! watcher and the host that draws them. Here the drawing is the shell's, and
//! the shell is a page with no bus, so this process owns
//! `org.kde.StatusNotifierWatcher`, reads each item, and tells every chrome
//! the tray as a [`HostMessage::Tray`](domicile_protocol::HostMessage::Tray).
//! A click comes back as `activate_tray_item` and is called on the item.
//!
//! What an item's properties are *shown as* is `domicile_host::tray`, which is
//! pure and tested there; so is the [`Registry`] of who registered what. This
//! is the bus, and nothing else.
//!
//! **One worker, and nothing it does waits on an application.** The watcher's
//! methods run on zbus's own executor and must not block it, so every one of
//! them, every signal an item sends and every click are events on one
//! channel, which a worker thread takes in turn. Reading an item is a thread
//! of its own that answers on that channel: zbus 4 waits on a reply for as
//! long as the bus lets it, and one slow application must not hold up the
//! others. Two more threads listen for the two kinds of signal that matter —
//! an item that changed, and a name that changed hands — because a blocking
//! iterator is one match rule on one thread.
//!
//! A click reaches this through the Wayland thread, which is where a locked
//! desk refuses it — see [`crate::lock::refused`].
//!
//! **Nothing here can take the desktop down**, for [`crate::appearance`]'s
//! reason: a desk on a bare tty may have no session bus, and a desk started
//! inside another session will find the watcher's name taken by that
//! session's panel. Either way the tray stays empty and the log says why once.
//!
//! **No menus yet.** An item's own menu is `com.canonical.dbusmenu`, which a
//! host has to read and draw; until that exists a secondary click asks the
//! item to open one itself with `ContextMenu`, which many items do not. See
//! ROADMAP.md.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

use domicile_host::tray::{address, item, method, Pixmap, Properties, Registry, Status, TrayIcons};
use domicile_protocol::{TrayAction, TrayItem};
use tracing::{debug, warn};
use zbus::blocking::object_server::InterfaceRef;
use zbus::blocking::{Connection, MessageIterator, Proxy};
use zbus::message::{Header, Type};
use zbus::zvariant::OwnedValue;
use zbus::{MatchRule, SignalContext};

/// The name a watcher answers on. KDE's, because it is the one every item
/// looks for: the freedesktop spelling was proposed and never taken up.
const WATCHER_NAME: &str = "org.kde.StatusNotifierWatcher";

/// Where the watcher answers.
const WATCHER_PATH: &str = "/StatusNotifierWatcher";

/// The interface every item implements.
const ITEM_INTERFACE: &str = "org.kde.StatusNotifierItem";

/// Something the worker has to do.
enum Event {
    /// `RegisterStatusNotifierItem(service)`, from `sender`.
    Registered { service: String, sender: String },
    /// An item's `New*` signal: something about how it looks moved.
    Changed { sender: String, path: String },
    /// A connection or a well-known name went away (`owner` empty), or a
    /// well-known name changed hands.
    Owner { name: String, owner: String },
    /// What reading `id` said, the `sequence`-th time it was asked.
    Read {
        id: String,
        sequence: u64,
        properties: zbus::Result<HashMap<String, OwnedValue>>,
    },
    /// A shell clicked an icon.
    Activate { id: String, action: TrayAction },
}

/// A handle on the tray: tell it a click and the item hears about it.
///
/// [`crate::appearance::Appearance`]'s shape and for its reason: a desk whose
/// watcher never started holds one of these that goes nowhere, so the caller
/// has one path for a click rather than one for a desk with a bus and another
/// for a desk without.
#[derive(Debug, Clone)]
pub struct Tray {
    told: Sender<Event>,
}

impl Tray {
    /// Ask the item `id` to do what a click with `action` means.
    pub fn activate(&self, id: String, action: TrayAction) {
        // A closed channel is a worker that has stopped, which it does only
        // after saying why.
        let _ = self.told.send(Event::Activate { id, action });
    }
}

/// Start being the desk's watcher and host, calling `publish` with the tray
/// whenever what it shows changes. Icons are looked for under `data_dirs`.
///
/// Returns as soon as the thread is spawned: whether a bus answers is not
/// something a desktop's startup should wait on.
pub fn serve(data_dirs: Vec<PathBuf>, publish: impl Fn(Vec<TrayItem>) + Send + 'static) -> Tray {
    let (told, events) = channel();
    let heard = told.clone();
    thread::spawn(move || {
        if let Err(why) = answer(heard, &events, TrayIcons::new(data_dirs), &publish) {
            warn!(
                %why,
                "the system tray is not being hosted; this desktop's applications \
                 will show no tray icons"
            );
        }
    });
    Tray { told }
}

/// Take the names, serve the watcher, listen, and do each event in turn.
/// Returns only on failure, or when the compositor has gone.
fn answer(
    told: Sender<Event>,
    events: &Receiver<Event>,
    mut icons: TrayIcons,
    publish: &dyn Fn(Vec<TrayItem>),
) -> zbus::Result<()> {
    let connection = Connection::session()?;
    connection.object_server().at(
        WATCHER_PATH,
        Watcher {
            told: told.clone(),
            items: Vec::new(),
        },
    )?;
    // Listening before the name is taken, so an item that registers the
    // moment it sees the watcher and changes straight after is not missed.
    listen(
        &connection,
        MatchRule::builder()
            .msg_type(Type::Signal)
            .interface(ITEM_INTERFACE)?
            .build(),
        told.clone(),
        changed,
    )?;
    listen(
        &connection,
        MatchRule::builder()
            .msg_type(Type::Signal)
            .sender("org.freedesktop.DBus")?
            .interface("org.freedesktop.DBus")?
            .member("NameOwnerChanged")?
            .build(),
        told.clone(),
        owner,
    )?;
    connection.request_name(WATCHER_NAME)?;
    // The host's own name, which is how an item that checks for one before
    // registering — `IsStatusNotifierHostRegistered` is the other way — finds
    // that there is a tray to be in.
    connection.request_name(format!("org.kde.StatusNotifierHost-{}", std::process::id()))?;
    debug!("this desktop hosts the system tray");

    let watcher = connection
        .object_server()
        .interface::<_, Watcher>(WATCHER_PATH)?;
    let mut registry = Registry::default();
    // How many reads of each item have been asked for: a read that answers
    // after a later one was asked is a picture that has already changed.
    let mut asked: HashMap<String, u64> = HashMap::new();
    // Ends when every sender has gone, which is the compositor exiting.
    for event in events {
        match event {
            Event::Registered { service, sender } => {
                // The connection that registered is the one the item's
                // signals come from; a well-known name that changes hands
                // later is followed by `Owner`.
                let (bus, path) = address(&service, &sender);
                if let Some(id) = registry.register(&bus, &sender, &path) {
                    debug!(%id, "a tray icon registered");
                    listed(&watcher, &registry, Some(&id), None);
                    read(&connection, &told, &mut asked, &registry, &id);
                }
            }
            Event::Changed { sender, path } => {
                for id in registry.sent_by(&sender, &path) {
                    read(&connection, &told, &mut asked, &registry, &id);
                }
            }
            Event::Owner { name, owner } if owner.is_empty() => {
                for id in registry.vanished(&name) {
                    debug!(%id, "a tray icon went away");
                    asked.remove(&id);
                    listed(&watcher, &registry, None, Some(&id));
                }
            }
            Event::Owner { name, owner } => registry.moved(&name, &owner),
            Event::Read {
                id,
                sequence,
                properties,
            } => {
                if asked.get(&id) == Some(&sequence) {
                    match properties {
                        Ok(properties) => {
                            registry.show(&id, item(&id, parse(properties), &mut icons));
                        }
                        // Held but not shown: an application whose tray code
                        // is broken, and nothing on this side can draw an
                        // icon it will not describe.
                        Err(why) => {
                            debug!(%id, %why, "a tray icon could not be read");
                            registry.show(&id, None);
                        }
                    }
                }
            }
            Event::Activate { id, action } => {
                activate(&connection, &registry, &id, action);
            }
        }
        publish(registry.items());
    }
    Ok(())
}

/// Say the watcher's list changed: the property, and which item arrived or
/// left.
///
/// A failure is said and gone past rather than ending the worker. An item
/// that missed a signal still has its icon in the tray, and a worker that
/// stopped would drop every click after it.
fn listed(
    watcher: &InterfaceRef<Watcher>,
    registry: &Registry,
    arrived: Option<&str>,
    left: Option<&str>,
) {
    watcher.get_mut().items = registry.ids();
    let context = watcher.signal_context();
    let said = zbus::block_on(async {
        watcher
            .get()
            .registered_status_notifier_items_changed(context)
            .await?;
        if let Some(id) = arrived {
            Watcher::status_notifier_item_registered(context, id).await?;
        }
        if let Some(id) = left {
            Watcher::status_notifier_item_unregistered(context, id).await?;
        }
        zbus::Result::Ok(())
    });
    if let Err(why) = said {
        warn!(%why, "the tray could not say its items changed");
    }
}

/// Ask the item `id` what it looks like, on a thread of its own, and hand
/// what it says back to the worker as an [`Event::Read`].
///
/// A thread rather than the call here because zbus 4 waits on a reply for as
/// long as the bus lets it — forever, on dbus-broker — and one application
/// that is slow to answer must not hold up every other icon, or the clicks.
fn read(
    connection: &Connection,
    told: &Sender<Event>,
    asked: &mut HashMap<String, u64>,
    registry: &Registry,
    id: &str,
) {
    let Some((bus, path)) = registry.address(id) else {
        return;
    };
    let sequence = asked.get(id).map_or(0, |sequence| sequence + 1);
    asked.insert(id.to_string(), sequence);
    let (connection, told, id) = (connection.clone(), told.clone(), id.to_string());
    thread::spawn(move || {
        let properties = Proxy::new(
            &connection,
            bus.as_str(),
            path.as_str(),
            "org.freedesktop.DBus.Properties",
        )
        .and_then(|proxy| {
            proxy.call::<_, _, HashMap<String, OwnedValue>>("GetAll", &(ITEM_INTERFACE,))
        });
        // A closed channel is a worker that has stopped, which it does only
        // after saying why.
        let _ = told.send(Event::Read {
            id,
            sequence,
            properties,
        });
    });
}

/// Call what a click with `action` means on the item `id`.
///
/// No reply is waited for. `Activate` on an item that has only a menu is an
/// error the item returns, and a click that did nothing is what the person
/// already saw; and an application that is slow to answer must not hold the
/// tray's other icons up.
fn activate(connection: &Connection, registry: &Registry, id: &str, action: TrayAction) {
    let Some((bus, path)) = registry.address(id) else {
        debug!(%id, "a click on a tray icon that has gone");
        return;
    };
    // Where on the screen the click was, which an X11 item positions its
    // own window by. A Wayland client cannot place a window, and the page's
    // coordinates are not the screen's, so it is told the corner.
    let called = Proxy::new(connection, bus.as_str(), path.as_str(), ITEM_INTERFACE)
        .and_then(|proxy| proxy.call_noreply(method(action), &(0i32, 0i32)));
    if let Err(why) = called {
        debug!(%id, %why, "a tray icon could not be clicked");
    }
}

/// What an item's `GetAll` says, as [`Properties`]. A property it left out,
/// or sent as something the spec does not say it is, is read as empty.
fn parse(mut properties: HashMap<String, OwnedValue>) -> Properties {
    let mut text = |name: &str| {
        properties
            .remove(name)
            .and_then(|value| String::try_from(value).ok())
            .unwrap_or_default()
    };
    let id = text("Id");
    let title = text("Title");
    let status = Status::from_wire(&text("Status"));
    let icon_name = text("IconName");
    let attention_icon_name = text("AttentionIconName");
    let icon_theme_path = text("IconThemePath");
    let mut pixmaps = |name: &str| {
        properties
            .remove(name)
            .and_then(|value| Vec::<(i32, i32, Vec<u8>)>::try_from(value).ok())
            .map(|pixmaps| {
                pixmaps
                    .into_iter()
                    .map(|(width, height, argb)| Pixmap {
                        width,
                        height,
                        argb,
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let icon_pixmaps = pixmaps("IconPixmap");
    let attention_pixmaps = pixmaps("AttentionIconPixmap");
    // `(icon name, icon pixmaps, title, description)`: the title is what a
    // label can say.
    let tooltip = properties
        .remove("ToolTip")
        .and_then(|value| {
            <(String, Vec<(i32, i32, Vec<u8>)>, String, String)>::try_from(value).ok()
        })
        .map(|(_, _, title, _)| title)
        .unwrap_or_default();
    Properties {
        id,
        title,
        tooltip,
        status,
        icon_name,
        icon_pixmaps,
        attention_icon_name,
        attention_pixmaps,
        icon_theme_path,
    }
}

/// Hand every message matching `rule` to `heard`, and what it makes of it to
/// the worker, on a thread of its own.
fn listen(
    connection: &Connection,
    rule: MatchRule<'static>,
    told: Sender<Event>,
    heard: fn(&zbus::Message) -> Option<Event>,
) -> zbus::Result<()> {
    let messages = MessageIterator::for_match_rule(rule, connection, None)?;
    thread::spawn(move || {
        for message in messages {
            match message {
                Ok(message) => {
                    if let Some(event) = heard(&message) {
                        if told.send(event).is_err() {
                            break;
                        }
                    }
                }
                // One message that would not decode is that message, not the
                // stream: said, and the next one read.
                Err(why) => debug!(%why, "the tray could not read a message"),
            }
        }
    });
    Ok(())
}

/// An item's signal: which connection sent it, about which object.
fn changed(message: &zbus::Message) -> Option<Event> {
    let header = message.header();
    Some(Event::Changed {
        sender: header.sender()?.to_string(),
        path: header.path()?.to_string(),
    })
}

/// `NameOwnerChanged`: who holds a name now, nobody included.
fn owner(message: &zbus::Message) -> Option<Event> {
    let (name, _, owner): (String, String, String) = message.body().deserialize().ok()?;
    Some(Event::Owner { name, owner })
}

/// The object at `/StatusNotifierWatcher`.
struct Watcher {
    told: Sender<Event>,
    /// The items registered, by id, as `RegisteredStatusNotifierItems` lists
    /// them. The worker's [`Registry`] is what decides this; it is copied
    /// here for the property to read.
    items: Vec<String>,
}

#[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
impl Watcher {
    /// An item asking to be in the tray. Handed to the worker, which reads it:
    /// nothing here may block the bus's executor.
    fn register_status_notifier_item(&self, service: &str, #[zbus(header)] header: Header<'_>) {
        if let Some(sender) = header.sender() {
            let _ = self.told.send(Event::Registered {
                service: service.to_string(),
                sender: sender.to_string(),
            });
        }
    }

    /// A second host. There is one tray on this desk and it is this one, so
    /// another is acknowledged and nothing more.
    fn register_status_notifier_host(&self, _service: &str) {}

    #[zbus(property)]
    fn registered_status_notifier_items(&self) -> Vec<String> {
        self.items.clone()
    }

    #[zbus(property)]
    fn is_status_notifier_host_registered(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn protocol_version(&self) -> i32 {
        0
    }

    #[zbus(signal)]
    async fn status_notifier_item_registered(
        context: &SignalContext<'_>,
        service: &str,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn status_notifier_item_unregistered(
        context: &SignalContext<'_>,
        service: &str,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn status_notifier_host_registered(context: &SignalContext<'_>) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use zbus::zvariant::Value;

    /// `properties` as a `GetAll` answers them.
    fn answered(properties: Vec<(&str, Value<'static>)>) -> HashMap<String, OwnedValue> {
        properties
            .into_iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    OwnedValue::try_from(value).expect("an ownable value"),
                )
            })
            .collect()
    }

    #[test]
    fn what_an_item_says_is_read_into_its_properties() {
        let pixmaps = vec![(1i32, 1i32, vec![255u8, 255, 0, 0])];
        let read = parse(answered(vec![
            ("Id", Value::from("nm-applet")),
            ("Title", Value::from("Network")),
            ("Status", Value::from("NeedsAttention")),
            ("IconName", Value::from("nm-signal-75")),
            ("AttentionIconName", Value::from("nm-no-connection")),
            ("IconThemePath", Value::from("/opt/nm/icons")),
            ("IconPixmap", Value::from(pixmaps.clone())),
            ("AttentionIconPixmap", Value::from(pixmaps)),
            (
                "ToolTip",
                Value::from((
                    String::new(),
                    Vec::<(i32, i32, Vec<u8>)>::new(),
                    "Wired connection 1".to_string(),
                    "Connected".to_string(),
                )),
            ),
        ]));

        let pixel = Pixmap {
            width: 1,
            height: 1,
            argb: vec![255, 255, 0, 0],
        };
        assert_eq!(
            read,
            Properties {
                id: "nm-applet".into(),
                title: "Network".into(),
                tooltip: "Wired connection 1".into(),
                status: Status::NeedsAttention,
                icon_name: "nm-signal-75".into(),
                icon_pixmaps: vec![pixel.clone()],
                attention_icon_name: "nm-no-connection".into(),
                attention_pixmaps: vec![pixel],
                icon_theme_path: "/opt/nm/icons".into(),
            }
        );
    }

    #[test]
    fn a_property_left_out_or_of_the_wrong_type_is_empty() {
        // Every property is optional in the spec, and an item that sends a
        // title as a number has sent no title.
        let read = parse(answered(vec![
            ("Id", Value::from("sync")),
            ("Title", Value::from(7u32)),
        ]));

        assert_eq!(
            read,
            Properties {
                id: "sync".into(),
                title: String::new(),
                tooltip: String::new(),
                status: Status::Active,
                icon_name: String::new(),
                icon_pixmaps: Vec::new(),
                attention_icon_name: String::new(),
                attention_pixmaps: Vec::new(),
                icon_theme_path: String::new(),
            }
        );
    }
}
