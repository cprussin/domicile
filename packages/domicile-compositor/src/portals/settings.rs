//! `org.freedesktop.impl.portal.Settings`, so Wayland clients follow the
//! desk's theme.
//!
//! GTK, Qt, Electron and Firefox read `color-scheme` from the
//! `org.freedesktop.appearance` namespace and follow its `SettingChanged`
//! signal. Theme changes are announced once every shell has captured its
//! wipe's start frame (see `domicile_host::theme_turnover`).

use std::collections::HashMap;

use domicile_protocol::Theme;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};

/// The standard namespace toolkits read the color scheme from.
const NAMESPACE: &str = "org.freedesktop.appearance";

/// The color scheme key in [`NAMESPACE`].
const COLOR_SCHEME: &str = "color-scheme";

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

/// The `Settings` backend object, serving only `color-scheme`.
///
/// Other keys are left to the next backend rather than answered with
/// invented values.
pub struct Settings {
    pub theme: Theme,
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

/// Signals `next` to every client, after storing it.
pub fn changed(
    served: &zbus::blocking::object_server::InterfaceRef<Settings>,
    next: Theme,
) -> zbus::Result<()> {
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
    ))
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
