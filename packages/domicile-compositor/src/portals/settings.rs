//! `org.freedesktop.impl.portal.Settings`, so Wayland clients follow the
//! desk's theme.
//!
//! GTK, Qt, Electron and Firefox read `color-scheme` from the
//! `org.freedesktop.appearance` namespace and follow its `SettingChanged`
//! signal. Theme changes are announced once every shell has captured its
//! wipe's start frame (see `domicile_host::theme_turnover`). `accent-color`,
//! `contrast` and `reduced-motion` come from the config's `theme` section and
//! change on reload.

use std::collections::HashMap;

use domicile_config::{AccentColor, Contrast, ThemeConfig};
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

/// The config's `theme` keys besides `mode`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Appearance {
    pub accent_color: Option<AccentColor>,
    pub contrast: Contrast,
    pub reduced_motion: bool,
}

impl From<&ThemeConfig> for Appearance {
    fn from(theme: &ThemeConfig) -> Self {
        Appearance {
            accent_color: theme.accent_color,
            contrast: theme.contrast,
            reduced_motion: theme.reduced_motion,
        }
    }
}

/// The `Settings` backend object, serving [`NAMESPACE`].
///
/// Other namespaces are left to the next backend rather than answered with
/// invented values.
pub struct Settings {
    pub theme: Theme,
    pub appearance: Appearance,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Settings")]
impl Settings {
    /// All settings in the requested namespaces. Empty for any namespace but
    /// [`NAMESPACE`].
    fn read_all(&self, namespaces: Vec<String>) -> HashMap<String, HashMap<String, OwnedValue>> {
        if wants_appearance(&namespaces) {
            HashMap::from([(
                NAMESPACE.to_string(),
                values(self.theme, &self.appearance)
                    .into_iter()
                    .map(|(key, value)| (key.to_string(), value))
                    .collect(),
            )])
        } else {
            HashMap::new()
        }
    }

    /// One setting (interface version 2).
    fn read_one(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
        values(self.theme, &self.appearance)
            .into_iter()
            .find(|(served, _)| namespace == NAMESPACE && *served == key)
            .map(|(_, value)| value)
            // Return an error so xdg-desktop-portal asks the next backend;
            // it moves on after any error. The spec names
            // `org.freedesktop.portal.Error.NotFound`, but the frontend does
            // not distinguish error names and `zbus::fdo::Error` lacks it.
            .ok_or_else(|| {
                zbus::fdo::Error::UnknownProperty(format!(
                    "{namespace} {key} is not a setting this desktop has"
                ))
            })
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

/// Stores `theme` and `appearance`, then signals every key that moved.
pub fn changed(
    served: &zbus::blocking::object_server::InterfaceRef<Settings>,
    theme: Option<Theme>,
    appearance: Option<Appearance>,
) -> zbus::Result<()> {
    // Store before signaling, and release the lock before the signals are
    // sent.
    let moved = {
        let mut settings = served.get_mut();
        let now_theme = theme.unwrap_or(settings.theme);
        let now_appearance = appearance.unwrap_or(settings.appearance);
        let moved = moved(
            settings.theme,
            &settings.appearance,
            now_theme,
            &now_appearance,
        );
        settings.theme = now_theme;
        settings.appearance = now_appearance;
        moved
    };
    for (key, value) in moved {
        // zbus's blocking API has no signal emitter, so block on the async
        // one.
        zbus::block_on(Settings::setting_changed(
            served.signal_emitter(),
            NAMESPACE,
            key,
            Value::from(value),
        ))?;
    }
    Ok(())
}

/// Every key in [`NAMESPACE`] and its value.
fn values(theme: Theme, appearance: &Appearance) -> Vec<(&'static str, OwnedValue)> {
    // The spec reads a channel outside 0 to 1 as no accent.
    let accent = appearance
        .accent_color
        .map_or((-1.0, -1.0, -1.0), |AccentColor([r, g, b])| {
            let channel = |byte: u8| f64::from(byte) / 255.0;
            (channel(r), channel(g), channel(b))
        });
    vec![
        (COLOR_SCHEME, OwnedValue::from(color_scheme(theme))),
        (
            "accent-color",
            OwnedValue::try_from(Value::from(accent)).expect("doubles hold no file descriptors"),
        ),
        (
            "contrast",
            OwnedValue::from(match appearance.contrast {
                Contrast::Normal => 0u32,
                Contrast::High => 1,
            }),
        ),
        (
            "reduced-motion",
            OwnedValue::from(u32::from(appearance.reduced_motion)),
        ),
    ]
}

/// The keys whose values differ between two looks, with their new values.
fn moved(
    was_theme: Theme,
    was: &Appearance,
    theme: Theme,
    now: &Appearance,
) -> Vec<(&'static str, OwnedValue)> {
    values(was_theme, was)
        .into_iter()
        .zip(values(theme, now))
        .filter(|((_, before), (_, after))| before != after)
        .map(|(_, after)| after)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_config::{AccentColor, Contrast};

    fn value(settings: &Settings, key: &str) -> OwnedValue {
        settings.read_one(NAMESPACE, key).expect("a setting")
    }

    #[test]
    fn the_look_is_read_from_the_config() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance {
                accent_color: Some(AccentColor([0xff, 0x33, 0])),
                contrast: Contrast::High,
                reduced_motion: true,
            },
        };

        assert_eq!(
            <(f64, f64, f64)>::try_from(value(&settings, "accent-color")).expect("(ddd)"),
            (1.0, 0.2, 0.0)
        );
        assert_eq!(u32::try_from(value(&settings, "contrast")), Ok(1));
        assert_eq!(u32::try_from(value(&settings, "reduced-motion")), Ok(1));
        assert_eq!(settings.read_all(Vec::new())[NAMESPACE].len(), 4);
    }

    #[test]
    fn no_accent_is_the_specs_out_of_range_color() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance::default(),
        };

        assert_eq!(
            <(f64, f64, f64)>::try_from(value(&settings, "accent-color")).expect("(ddd)"),
            (-1.0, -1.0, -1.0)
        );
        assert_eq!(u32::try_from(value(&settings, "contrast")), Ok(0));
        assert_eq!(u32::try_from(value(&settings, "reduced-motion")), Ok(0));
    }

    #[test]
    fn a_new_look_changes_only_the_keys_that_moved() {
        let was = Appearance::default();
        let now = Appearance {
            reduced_motion: true,
            ..was
        };

        assert_eq!(
            moved(Theme::Dark, &was, Theme::Dark, &now),
            [("reduced-motion", OwnedValue::from(1u32))]
        );
        assert_eq!(
            moved(Theme::Dark, &was, Theme::Light, &was),
            [(COLOR_SCHEME, OwnedValue::from(2u32))]
        );
    }

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
