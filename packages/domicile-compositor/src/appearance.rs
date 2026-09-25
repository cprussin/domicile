//! What the desk's *clients* are told about the theme.
//!
//! The chrome hears about a theme over the host protocol, because the chrome
//! is a page on the end of a socket this process already owns. Every other
//! window on the desk is a Wayland client that has never heard of that socket,
//! and there is no Wayland protocol for "which way round is this desktop
//! drawn" — `wl_output` describes pixels, not taste.
//!
//! What there is instead is the **settings portal**. GTK4 and libadwaita, Qt6,
//! Electron and Firefox all read `color-scheme` out of the
//! `org.freedesktop.appearance` namespace on `org.freedesktop.portal.Settings`
//! and follow the `SettingChanged` signal for it while they run — it is the
//! one thing every toolkit on a Linux desktop agrees about, and it is how a
//! GNOME or a KDE dark-mode switch reaches an app that is neither. So Domicile
//! answers it, and a click on the shell's toggle turns the windows over with
//! the panels rather than after them.
//!
//! **The backend half, not the frontend.** `xdg-desktop-portal` is the process
//! apps actually talk to; what a desktop supplies is an implementation of
//! `org.freedesktop.impl.portal.Settings` for the frontend to route to, chosen
//! by `XDG_CURRENT_DESKTOP` and the `.portal` files the frontend reads. That
//! is why this owns `org.freedesktop.impl.portal.desktop.domicile` and not
//! `org.freedesktop.portal.Desktop`: taking the frontend's name would mean
//! this process also had to implement FileChooser, ScreenCast and the dozen
//! other interfaces an app asks for, which it does not and should not.
//!
//! **A backend is only reached if the frontend was told which desktop this
//! is.** `xdg-desktop-portal` picks both its `portals.conf` and its `UseIn=`
//! matches out of *its own* `XDG_CURRENT_DESKTOP` — not the calling client's —
//! and it is D-Bus- or systemd-activated, so what it inherits is whatever the
//! session was started with. Setting the variable on the clients this
//! compositor spawns does nothing for it. [`say_which_desktop`] is the other
//! half, and it is what every Wayland compositor does at startup under the
//! name `dbus-update-activation-environment --systemd`.
//!
//! What that cannot do is re-route a frontend that is **already running**
//! under another desktop's name: the environment reaches services activated
//! after the call and nothing else. A desk started from inside a sway session
//! therefore keeps sway's portal routing until that frontend exits, which is a
//! developer's nested run rather than a desk somebody uses — see ROADMAP.md.
//!
//! **Nothing here can take the desktop down.** A desk on a bare tty may have
//! no session bus at all, and a desk started inside another session may find
//! the name already taken. Both leave the desktop running with its own theme
//! working and its clients not following it — which is exactly where every
//! desktop was before this existed — and both say so once in the log. A
//! compositor that exited because a bus was missing would be a desktop that
//! will not start on a machine where the previous build ran fine.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

use domicile_protocol::Theme;
use tracing::{debug, warn};
use zbus::zvariant::{OwnedValue, Value};
use zbus::SignalContext;

/// The namespace every toolkit reads a color scheme out of.
///
/// Not a Domicile name and deliberately not one: the point of answering this
/// at all is that an app built for GNOME, for KDE or for neither already knows
/// to ask for it.
const NAMESPACE: &str = "org.freedesktop.appearance";

/// The key inside it.
const COLOR_SCHEME: &str = "color-scheme";

/// Where the frontend looks for a backend's implementation.
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";

/// The well-known name this backend answers on.
///
/// The suffix is what a `.portal` file and `XDG_CURRENT_DESKTOP` name, which
/// is how `xdg-desktop-portal` decides that a desk running Domicile should
/// route `Settings` here rather than to the GTK backend.
const BUS_NAME: &str = "org.freedesktop.impl.portal.desktop.domicile";

/// What this desktop calls itself to the things that route by it.
///
/// **A routing key rather than a label**, and it is read in two places that
/// have to agree: `xdg-desktop-portal` matches it against the `UseIn=` in the
/// `.portal` files it finds, and `domicile.portal` in the flake names the same
/// word. It is also what a `.desktop` file's `OnlyShowIn`/`NotShowIn` is
/// matched against, so a desk that called itself nothing would show every
/// entry an application ships for every other desktop.
///
/// Set in two places for the two readers: [`say_which_desktop`] puts it where
/// the portal frontend will be activated from, and `client_command` puts it in
/// each client's own environment.
pub const CURRENT_DESKTOP: &str = "domicile";

/// The version of `org.freedesktop.impl.portal.Settings` this implements.
///
/// 2 is the version that has `ReadOne`; 1 had only `Read`, which this answers
/// as well because an app built against the older frontend still calls it.
const INTERFACE_VERSION: u32 = 2;

/// What `color-scheme` is, for a theme.
///
/// The three values the spec defines, of which a Domicile desk can only ever
/// be two: `0` is "no preference", which is what a desktop with no opinion
/// answers and Domicile always has one. `1` is prefer-dark and `2` is
/// prefer-light — and the numbering is *not* an accident worth guessing at,
/// which is why this function exists rather than a cast: light being 2 and
/// dark being 1 is the opposite of the order the themes are written in
/// everywhere else in this repository.
pub fn color_scheme(theme: Theme) -> u32 {
    match theme {
        Theme::Dark => 1,
        Theme::Light => 2,
    }
}

/// Whether a `ReadAll` asking for `requested` wants this namespace.
///
/// The spec's matching is by prefix on the dotted name, so
/// `org.freedesktop` asks for `org.freedesktop.appearance` and
/// `org.freedesktop.appearances` does not. An empty list is "everything",
/// which is what a client with no particular question sends.
pub fn wants_appearance(requested: &[String]) -> bool {
    requested.is_empty()
        || requested.iter().any(|namespace| {
            NAMESPACE == namespace
                || NAMESPACE
                    .strip_prefix(namespace.as_str())
                    .is_some_and(|rest| rest.starts_with('.'))
        })
}

/// A handle on the desk's clients: tell it a theme and they hear about it.
///
/// Cheap to clone and cheap to drop. A desktop whose service never started —
/// no bus, or a name already taken — holds one of these that goes nowhere,
/// which is deliberate: the caller has one path for "the theme changed"
/// rather than one for a desk with a portal and another for a desk without.
#[derive(Debug, Clone)]
pub struct Appearance {
    told: Sender<Theme>,
}

impl Appearance {
    /// Tell the desk's clients which way round it is drawn now.
    ///
    /// Returns nothing, and cannot fail from the caller's side: the send is
    /// dropped where no service is running, which is the case this type exists
    /// to make uninteresting. What the clients then do is theirs — an app that
    /// does not read the portal is an app that does not follow the theme, and
    /// there is nothing above it that can make it.
    /// A handle with nobody on the other end.
    ///
    /// For a `ChromeHub` built where there is no portal to answer, which in
    /// this repository is every unit test: they drive chrome connections
    /// against a hub in-process and have no session bus, and a test that
    /// started one would be asserting D-Bus rather than the compositor.
    #[cfg(test)]
    pub fn to_nobody() -> Self {
        // The receiver is dropped here, which is the same state a service
        // thread that has stopped leaves behind -- so this is the documented
        // case rather than a second one.
        let (told, _) = channel();
        Appearance { told }
    }

    pub fn announce(&self, theme: Theme) {
        // The receiving end is the service thread, so a closed channel is a
        // thread that has stopped -- which it does only after saying why.
        let _ = self.told.send(theme);
    }
}

/// Start answering the settings portal, with `theme` as the desk's current
/// one.
///
/// Returns as soon as the thread is spawned rather than when the name is
/// taken: whether a bus answers is not something a desktop's startup should
/// wait on, and the first client to ask arrives long after either way.
pub fn serve(theme: Theme) -> Appearance {
    let (told, changes) = channel();
    thread::spawn(move || {
        // Every failure below is the same failure from the caller's side --
        // the desk runs, its clients do not follow the theme -- so they are
        // one arm rather than four, and the message names what was being
        // attempted rather than only what went wrong.
        if let Err(why) = answer(theme, &changes) {
            warn!(
                %why,
                "the settings portal is not being answered; this desktop's \
                 clients will not follow its theme"
            );
        }
    });
    Appearance { told }
}

/// Take the name, serve the interface, and restate the theme whenever it
/// moves. Returns only on failure, or when the compositor has gone.
fn answer(theme: Theme, changes: &Receiver<Theme>) -> Result<(), zbus::Error> {
    let connection = zbus::blocking::connection::Builder::session()?
        .name(BUS_NAME)?
        .serve_at(OBJECT_PATH, Settings { theme })?
        .build()?;
    debug!(
        name = BUS_NAME,
        scheme = color_scheme(theme),
        "this desktop answers the settings portal, so its clients follow its theme"
    );
    say_which_desktop(&connection);
    let served = connection
        .object_server()
        .interface::<_, Settings>(OBJECT_PATH)?;
    // Ends when the sending half goes, which is the compositor exiting.
    for next in changes {
        // Scoped, so the interface's lock is not held across the signal: what
        // a client reads and what it is told are the same value, and the write
        // has to land before the telling.
        {
            served.get_mut().theme = next;
        }
        // `block_on` is zbus's own re-export of the executor its `blocking`
        // module is built on, and the one thing that module does not wrap: a
        // signal is emitted through the async `SignalContext` whichever API
        // you hold. This thread exists to block, so blocking here is what it
        // is for.
        zbus::block_on(Settings::setting_changed(
            served.signal_context(),
            NAMESPACE,
            COLOR_SCHEME,
            Value::from(color_scheme(next)),
        ))?;
    }
    Ok(())
}

/// Put `XDG_CURRENT_DESKTOP` where a portal frontend will be activated from.
///
/// **Without this the backend above is never chosen**, however correctly it
/// answers. `xdg-desktop-portal` reads its own environment to decide which
/// `portals.conf` to load and which `UseIn=` to match, and it is started by
/// D-Bus or by the systemd user manager rather than by this process — so the
/// variable has to be put into *their* activation environments, which is what
/// these two calls are. `dbus-update-activation-environment --systemd` is the
/// same pair of calls with a command line around it, and it is what a sway
/// config runs by hand at startup.
///
/// **Both are best effort and neither is fatal.** A desk with no systemd user
/// manager is an ordinary desk, and a frontend already running under another
/// desktop's name will not be re-routed by either call — see this module's
/// head. Said at `debug` rather than `warn` for that reason: the thing worth a
/// warning is the portal not being answered at all, and that is
/// [`serve`]'s line.
fn say_which_desktop(connection: &zbus::blocking::Connection) {
    // The bus's own activation environment, for a service it starts directly.
    let bus = zbus::blocking::Proxy::new(
        connection,
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
    );
    let told_the_bus = bus.and_then(|bus| {
        bus.call::<_, _, ()>(
            "UpdateActivationEnvironment",
            &(HashMap::from([("XDG_CURRENT_DESKTOP", CURRENT_DESKTOP)]),),
        )
    });
    if let Err(why) = told_the_bus {
        tracing::debug!(%why, "the session bus would not take this desktop's name");
    }

    // And the systemd user manager, which is what actually starts the portal
    // frontend on a distribution that ships it as a unit -- the bus call above
    // hands the unit nothing. `KEY=VALUE` strings, which is the shape
    // `SetEnvironment` takes.
    let systemd = zbus::blocking::Proxy::new(
        connection,
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
    );
    let told_systemd = systemd.and_then(|systemd| {
        systemd.call::<_, _, ()>(
            "SetEnvironment",
            &(vec![format!("XDG_CURRENT_DESKTOP={CURRENT_DESKTOP}")],),
        )
    });
    if let Err(why) = told_systemd {
        tracing::debug!(%why, "no systemd user manager to tell this desktop's name to");
    }
}

/// The object at `/org/freedesktop/portal/desktop`.
///
/// One namespace and one key. A desktop's own settings backend usually carries
/// the whole of GNOME's `org.gnome.desktop.interface` as well -- the accent
/// color, the font, the cursor theme -- and none of those is a thing Domicile
/// has yet. A backend that answered them with invented values would be worse
/// than one that says it has nothing: the frontend falls back to the next
/// backend for a namespace nobody implements.
struct Settings {
    theme: Theme,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Settings")]
impl Settings {
    /// Everything this backend has to say, filtered to what was asked for.
    ///
    /// An empty answer is a real one: it is a backend saying it has no opinion
    /// about the namespaces in the question, which is the honest reply to
    /// anything but `org.freedesktop.appearance`.
    fn read_all(&self, namespaces: Vec<String>) -> HashMap<String, HashMap<String, OwnedValue>> {
        if wants_appearance(&namespaces) {
            HashMap::from([(
                NAMESPACE.to_string(),
                HashMap::from([(
                    COLOR_SCHEME.to_string(),
                    OwnedValue::from(color_scheme(self.theme)),
                )]),
            )])
        } else {
            HashMap::new()
        }
    }

    /// One setting, for version 2 of this interface.
    fn read_one(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
        if namespace == NAMESPACE && key == COLOR_SCHEME {
            Ok(OwnedValue::from(color_scheme(self.theme)))
        } else {
            // AN ERROR, BECAUSE THE FRONTEND CONTINUES ON ONE. `Settings` is
            // multi-backend: xdg-desktop-portal walks the backends in the
            // order the profile names them and moves to the next on any error
            // from one, so refusing here is how a key this desktop has never
            // heard of reaches the backend that has. Answering `0` instead
            // would be this desktop claiming to have no opinion about it,
            // which ends the walk with the wrong answer.
            //
            // NOT the error the portal spec names, which is
            // `org.freedesktop.portal.Error.NotFound`: `zbus::fdo::Error` is
            // the standard D-Bus set and carries no portal-namespaced
            // variant, and a `DBusError` type of our own would be machinery
            // for a distinction the frontend does not draw.
            Err(zbus::fdo::Error::UnknownProperty(format!(
                "{namespace} {key} is not a setting this desktop has"
            )))
        }
    }

    /// The same question under the name version 1 gave it.
    ///
    /// Kept because an app built against the older frontend still calls it,
    /// and because a backend that answers only `ReadOne` looks to that
    /// frontend exactly like a backend with no settings at all.
    fn read(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
        self.read_one(namespace, key)
    }

    #[zbus(signal)]
    async fn setting_changed(
        context: &SignalContext<'_>,
        namespace: &str,
        key: &str,
        value: Value<'_>,
    ) -> zbus::Result<()>;

    #[zbus(property(emits_changed_signal = "const"))]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_is_one_and_light_is_two() {
        // THE ONE PLACE IN THIS REPOSITORY WHERE THE THEMES ARE NUMBERED, and
        // they are numbered the other way round from how they are written
        // everywhere else -- `THEMES`, `mojom::Theme` and the config's own
        // enum all put dark first. A cast would have made light 1 and dark 0,
        // which is "no preference" and would leave every client on the desk
        // deciding for itself.
        assert_eq!(color_scheme(Theme::Dark), 1);
        assert_eq!(color_scheme(Theme::Light), 2);
    }

    #[test]
    fn a_question_about_nothing_in_particular_wants_this() {
        assert!(wants_appearance(&[]));
    }

    #[test]
    fn a_question_naming_this_namespace_wants_it() {
        assert!(wants_appearance(&[NAMESPACE.to_string()]));
    }

    #[test]
    fn a_question_naming_a_prefix_of_it_wants_it() {
        // The spec matches on the dotted name, so an app asking for
        // everything freedesktop is asking for this too.
        assert!(wants_appearance(&["org.freedesktop".to_string()]));
    }

    #[test]
    fn a_prefix_that_is_not_a_dotted_one_does_not_want_it() {
        // `org.freedesktop.appearance` starts with the string
        // `org.freedesktop.appear`, and a naive `starts_with` would answer a
        // question nobody asked. The next component has to begin.
        assert!(!wants_appearance(&["org.freedesktop.appear".to_string()]));
    }

    #[test]
    fn a_question_about_somebody_elses_settings_does_not_want_it() {
        assert!(!wants_appearance(&[
            "org.gnome.desktop.interface".to_string()
        ]));
    }
}
