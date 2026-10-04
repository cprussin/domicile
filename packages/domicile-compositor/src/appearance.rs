//! Answers the settings portal so Wayland clients follow the desk's theme.
//!
//! GTK, Qt, Electron and Firefox read `color-scheme` from the
//! `org.freedesktop.appearance` namespace and follow its `SettingChanged`
//! signal. This module implements the backend interface
//! `org.freedesktop.impl.portal.Settings`; `xdg-desktop-portal` routes to it
//! by `XDG_CURRENT_DESKTOP`. Theme changes are announced once every shell has
//! captured its wipe's start frame (see `domicile_host::theme_turnover`). See
//! `docs/architecture/PORTALS.md`.
//!
//! `xdg-desktop-portal` is activated by D-Bus or systemd, so it reads
//! `XDG_CURRENT_DESKTOP` from their activation environment, not from this
//! process's clients. [`say_which_desktop`] sets it there. This does not
//! re-route a frontend that is already running.
//!
//! Failures (no session bus, name taken) are logged once and leave clients
//! unthemed; they never stop the compositor.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

use domicile_protocol::Theme;
use tracing::{debug, warn};
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};

/// The standard namespace toolkits read the color scheme from.
const NAMESPACE: &str = "org.freedesktop.appearance";

/// The color scheme key in [`NAMESPACE`].
const COLOR_SCHEME: &str = "color-scheme";

/// The object path the frontend calls backends at.
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";

/// The bus name this backend owns.
///
/// Owns the backend name, not the frontend's `org.freedesktop.portal.Desktop`,
/// so other portal interfaces still reach their own backends.
const BUS_NAME: &str = "org.freedesktop.impl.portal.desktop.domicile";

/// This desktop's `XDG_CURRENT_DESKTOP` value.
///
/// Must match `UseIn=` in the flake's `domicile.portal`. `.desktop` files'
/// `OnlyShowIn`/`NotShowIn` also match on it. [`say_which_desktop`] sets it
/// for activated services and `client_command` for spawned clients.
pub const CURRENT_DESKTOP: &str = "domicile";

/// The `org.freedesktop.impl.portal.Settings` version implemented. Version 2
/// adds `ReadOne`.
const INTERFACE_VERSION: u32 = 2;

/// The portal's `color-scheme` value for a theme.
///
/// The spec defines 0 as no preference, 1 as dark and 2 as light. Do not
/// replace this with a cast: `Theme` lists dark first, so a cast gives 0.
pub fn color_scheme(theme: Theme) -> u32 {
    match theme {
        Theme::Dark => 1,
        Theme::Light => 2,
    }
}

/// Whether a `ReadAll` for `requested` includes `org.freedesktop.appearance`.
///
/// Matches whole dotted components by prefix, so `org.freedesktop` matches
/// and `org.freedesktop.appear` does not. An empty list matches everything.
pub fn wants_appearance(requested: &[String]) -> bool {
    requested.is_empty()
        || requested.iter().any(|namespace| {
            NAMESPACE == namespace
                || NAMESPACE
                    .strip_prefix(namespace.as_str())
                    .is_some_and(|rest| rest.starts_with('.'))
        })
}

/// Handle for announcing theme changes to the portal thread.
///
/// If the service failed to start, announcements are dropped, so callers need
/// no separate path for a desk without a portal.
#[derive(Debug, Clone)]
pub struct Appearance {
    told: Sender<Theme>,
}

impl Appearance {
    /// A handle with no service behind it, for unit tests without a session
    /// bus.
    #[cfg(test)]
    pub fn to_nobody() -> Self {
        // Same state as a service thread that has stopped.
        let (told, _) = channel();
        Appearance { told }
    }

    /// Tells the desk's clients the current theme. Dropped if no service is
    /// running.
    pub fn announce(&self, theme: Theme) {
        // A closed channel means the service stopped and already logged why.
        let _ = self.told.send(theme);
    }
}

/// Starts the settings portal thread with `theme` as the current theme, and
/// sets the activation environment. See [`activation_environment`] for `ours`
/// and `nested_in`.
///
/// Returns without waiting for the bus, so startup never blocks on D-Bus.
pub fn serve(theme: Theme, ours: &str, nested_in: Option<&OsStr>) -> Appearance {
    let environment = activation_environment(ours, nested_in);
    let (told, changes) = channel();
    thread::spawn(move || {
        // Every failure has the same effect: clients do not follow the theme.
        if let Err(why) = answer(theme, &environment, &changes) {
            warn!(
                %why,
                "the settings portal is not being answered; this desktop's \
                 clients will not follow its theme"
            );
        }
    });
    Appearance { told }
}

/// Sets the activation environment, serves the interface, and signals each
/// theme change. Returns on failure or when every handle is dropped.
///
/// Sets the environment before taking the name, so it is set even if another
/// desk holds the name.
fn answer(
    theme: Theme,
    environment: &[(&str, String)],
    changes: &Receiver<Theme>,
) -> Result<(), zbus::Error> {
    let connection = zbus::blocking::Connection::session()?;
    say_which_desktop(&connection, environment);
    connection
        .object_server()
        .at(OBJECT_PATH, Settings { theme })?;
    connection.request_name(BUS_NAME)?;
    debug!(
        name = BUS_NAME,
        scheme = color_scheme(theme),
        "this desktop answers the settings portal, so its clients follow its theme"
    );
    let served = connection
        .object_server()
        .interface::<_, Settings>(OBJECT_PATH)?;
    // Ends when every `Appearance` is dropped.
    for next in changes {
        // Update the stored theme before signaling, and release the lock
        // before the signal is sent.
        {
            served.get_mut().theme = next;
        }
        // zbus's blocking API has no signal emitter, so block on the async one.
        zbus::block_on(Settings::setting_changed(
            served.signal_emitter(),
            NAMESPACE,
            COLOR_SCHEME,
            Value::from(color_scheme(next)),
        ))?;
    }
    Ok(())
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

/// The `Settings` backend object, serving only `color-scheme`.
///
/// Other keys are left to the next backend rather than answered with
/// invented values.
struct Settings {
    theme: Theme,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Settings")]
impl Settings {
    /// All settings in the requested namespaces. Empty for any namespace but
    /// [`NAMESPACE`].
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

    /// One setting (interface version 2).
    fn read_one(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
        if namespace == NAMESPACE && key == COLOR_SCHEME {
            Ok(OwnedValue::from(color_scheme(self.theme)))
        } else {
            // Return an error so xdg-desktop-portal asks the next backend;
            // it moves on after any error. The spec names
            // `org.freedesktop.portal.Error.NotFound`, but the frontend does
            // not distinguish error names and `zbus::fdo::Error` lacks it.
            Err(zbus::fdo::Error::UnknownProperty(format!(
                "{namespace} {key} is not a setting this desktop has"
            )))
        }
    }

    /// Version 1's name for [`Self::read_one`], still called by older
    /// frontends.
    fn read(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
        self.read_one(namespace, key)
    }

    #[zbus(signal)]
    async fn setting_changed(
        emitter: &SignalEmitter<'_>,
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
        // The portal numbers differ from `Theme`'s order; dark is 1, not 0
        // (0 means no preference).
        assert_eq!(color_scheme(Theme::Dark), 1);
        assert_eq!(color_scheme(Theme::Light), 2);
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
        // The spec matches dotted-name prefixes.
        assert!(wants_appearance(&["org.freedesktop".to_string()]));
    }

    #[test]
    fn a_prefix_that_is_not_a_dotted_one_does_not_want_it() {
        // A string prefix that ends mid-component does not match.
        assert!(!wants_appearance(&["org.freedesktop.appear".to_string()]));
    }

    #[test]
    fn a_question_about_somebody_elses_settings_does_not_want_it() {
        assert!(!wants_appearance(&[
            "org.gnome.desktop.interface".to_string()
        ]));
    }
}
