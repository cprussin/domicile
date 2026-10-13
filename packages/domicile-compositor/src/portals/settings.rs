//! `org.freedesktop.impl.portal.Settings`, so Wayland clients follow the
//! desk's theme.
//!
//! GTK, Qt, Electron and Firefox read `color-scheme` from the
//! `org.freedesktop.appearance` namespace and follow its `SettingChanged`
//! signal. Theme changes are announced once every shell has captured its
//! wipe's start frame (see `domicile_host::theme_turnover`). `accent-color`,
//! `contrast` and `reduced-motion` come from the config's `theme` section and
//! change on reload. `org.gnome.desktop.interface` repeats the color scheme
//! and motion for GTK 3, and carries the icon theme, which shells read too,
//! and the cursor and fonts.

use std::collections::HashMap;

use domicile_config::{AccentColor, Contrast, ThemeConfig};
use domicile_protocol::Theme;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};

/// The standard namespace toolkits read the color scheme from.
const NAMESPACE: &str = "org.freedesktop.appearance";

/// The color scheme key in [`NAMESPACE`] and [`INTERFACE`].
const COLOR_SCHEME: &str = "color-scheme";

/// GNOME's interface settings, where GTK reads the icon theme, cursor and
/// fonts.
const INTERFACE: &str = "org.gnome.desktop.interface";

/// The icon theme key in [`INTERFACE`].
const ICON_THEME: &str = "icon-theme";

/// The cursor and font keys in [`INTERFACE`].
const CURSOR_THEME: &str = "cursor-theme";
const CURSOR_SIZE: &str = "cursor-size";
const FONT_NAME: &str = "font-name";
const MONOSPACE_FONT_NAME: &str = "monospace-font-name";

/// GNOME's animation switch in [`INTERFACE`], the inverse of `reduced-motion`.
const ENABLE_ANIMATIONS: &str = "enable-animations";

/// The theme every icon theme inherits, signaled when the config's is unset.
const HICOLOR: &str = "hicolor";

/// What a client falls back to without a cursor or font setting, signaled
/// when the config's is unset: XCursor's `default` theme, and GTK's size and
/// fonts.
const DEFAULT_CURSOR_THEME: &str = "default";
const DEFAULT_CURSOR_SIZE: i32 = 24;
const DEFAULT_FONT_NAME: &str = "Sans 10";
const DEFAULT_MONOSPACE_FONT_NAME: &str = "Monospace 10";

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

/// Whether a `ReadAll` for `requested` includes `namespace`.
///
/// Matches whole dotted components by prefix, so `org.freedesktop` matches
/// `org.freedesktop.appearance` and `org.freedesktop.appear` does not. An
/// empty list matches everything.
fn wants(namespace: &str, requested: &[String]) -> bool {
    requested.is_empty()
        || requested.iter().any(|prefix| {
            namespace == prefix
                || namespace
                    .strip_prefix(prefix.as_str())
                    .is_some_and(|rest| rest.starts_with('.'))
        })
}

/// The config's `theme` keys besides `mode`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Appearance {
    pub accent_color: Option<AccentColor>,
    pub contrast: Contrast,
    pub reduced_motion: bool,
    pub icon_theme: Option<String>,
    pub cursor_theme: Option<String>,
    pub cursor_size: Option<u16>,
    pub font_name: Option<String>,
    pub monospace_font_name: Option<String>,
}

impl From<&ThemeConfig> for Appearance {
    fn from(theme: &ThemeConfig) -> Self {
        Appearance {
            accent_color: theme.accent_color,
            contrast: theme.contrast,
            reduced_motion: theme.reduced_motion,
            icon_theme: theme.icon_theme.clone(),
            cursor_theme: theme.cursor_theme.clone(),
            cursor_size: theme.cursor_size,
            font_name: theme.font_name.clone(),
            monospace_font_name: theme.monospace_font_name.clone(),
        }
    }
}

/// The same keys for the shell, which follows them too. The icon theme
/// reaches shells through this portal instead.
impl From<&Appearance> for domicile_protocol::Appearance {
    fn from(appearance: &Appearance) -> Self {
        domicile_protocol::Appearance {
            accent_color: appearance
                .accent_color
                .map(|AccentColor([r, g, b])| format!("#{r:02x}{g:02x}{b:02x}")),
            high_contrast: appearance.contrast == Contrast::High,
            reduced_motion: appearance.reduced_motion,
        }
    }
}

/// The `Settings` backend object, serving [`NAMESPACE`] and [`INTERFACE`].
///
/// Other keys are left to the next backend rather than answered with
/// invented values.
pub struct Settings {
    pub theme: Theme,
    pub appearance: Appearance,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Settings")]
impl Settings {
    /// All settings in the requested namespaces.
    fn read_all(&self, namespaces: Vec<String>) -> HashMap<String, HashMap<String, OwnedValue>> {
        let mut read: HashMap<String, HashMap<String, OwnedValue>> = HashMap::new();
        for (namespace, key, value) in values(self.theme, &self.appearance) {
            if wants(namespace, &namespaces) {
                read.entry(namespace.to_string())
                    .or_default()
                    .insert(key.to_string(), value);
            }
        }
        read
    }

    /// One setting (interface version 2).
    fn read_one(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
        values(self.theme, &self.appearance)
            .into_iter()
            .find(|(served_namespace, served_key, _)| {
                namespace == *served_namespace && key == *served_key
            })
            .map(|(_, _, value)| value)
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
        let now_appearance = appearance.unwrap_or_else(|| settings.appearance.clone());
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
    for (namespace, key, value) in moved {
        // zbus's blocking API has no signal emitter, so block on the async
        // one.
        zbus::block_on(Settings::setting_changed(
            served.signal_emitter(),
            namespace,
            key,
            Value::from(value),
        ))?;
    }
    Ok(())
}

/// A served setting: its namespace, key and value.
type Setting = (&'static str, &'static str, OwnedValue);

/// Every key served and its value. The [`named`] keys are served only when
/// set.
fn values(theme: Theme, appearance: &Appearance) -> Vec<Setting> {
    let mut served = looks(theme, appearance);
    served.extend(gnome_looks(theme, appearance));
    served.extend(
        named(appearance)
            .into_iter()
            .filter_map(|(key, set, _)| set.map(|value| (INTERFACE, key, value))),
    );
    served
}

/// Every key in [`NAMESPACE`] and its value.
fn looks(theme: Theme, appearance: &Appearance) -> Vec<Setting> {
    // The spec reads a channel outside 0 to 1 as no accent.
    let accent = appearance
        .accent_color
        .map_or((-1.0, -1.0, -1.0), |AccentColor([r, g, b])| {
            let channel = |byte: u8| f64::from(byte) / 255.0;
            (channel(r), channel(g), channel(b))
        });
    vec![
        (
            NAMESPACE,
            COLOR_SCHEME,
            OwnedValue::from(color_scheme(theme)),
        ),
        (
            NAMESPACE,
            "accent-color",
            OwnedValue::try_from(Value::from(accent)).expect("doubles hold no file descriptors"),
        ),
        (
            NAMESPACE,
            "contrast",
            OwnedValue::from(match appearance.contrast {
                Contrast::Normal => 0u32,
                Contrast::High => 1,
            }),
        ),
        (
            NAMESPACE,
            "reduced-motion",
            OwnedValue::from(u32::from(appearance.reduced_motion)),
        ),
    ]
}

/// The keys in [`INTERFACE`] that GTK 3 reads instead of [`NAMESPACE`]'s.
fn gnome_looks(theme: Theme, appearance: &Appearance) -> [Setting; 2] {
    let scheme = match theme {
        Theme::Dark => "prefer-dark",
        Theme::Light => "prefer-light",
    };
    [
        (
            INTERFACE,
            COLOR_SCHEME,
            OwnedValue::try_from(Value::from(scheme)).expect("a string holds no file descriptors"),
        ),
        (
            INTERFACE,
            ENABLE_ANIMATIONS,
            OwnedValue::from(!appearance.reduced_motion),
        ),
    ]
}

/// The keys in [`INTERFACE`] named by the config, each with its value when
/// set and the value signaled when a reload unsets it.
fn named(appearance: &Appearance) -> [(&'static str, Option<OwnedValue>, OwnedValue); 5] {
    let text = |name: &str| {
        OwnedValue::try_from(Value::from(name)).expect("a string holds no file descriptors")
    };
    let text_or = |key, set: &Option<String>, unset| (key, set.as_deref().map(text), text(unset));
    [
        text_or(ICON_THEME, &appearance.icon_theme, HICOLOR),
        text_or(CURSOR_THEME, &appearance.cursor_theme, DEFAULT_CURSOR_THEME),
        (
            CURSOR_SIZE,
            appearance
                .cursor_size
                .map(|size| OwnedValue::from(i32::from(size))),
            OwnedValue::from(DEFAULT_CURSOR_SIZE),
        ),
        text_or(FONT_NAME, &appearance.font_name, DEFAULT_FONT_NAME),
        text_or(
            MONOSPACE_FONT_NAME,
            &appearance.monospace_font_name,
            DEFAULT_MONOSPACE_FONT_NAME,
        ),
    ]
}

/// The keys whose values differ between two looks, with their new values.
///
/// A [`named`] key the config stops setting is signaled as its unset value: a
/// client has no other way to hear that it went.
fn moved(was_theme: Theme, was: &Appearance, theme: Theme, now: &Appearance) -> Vec<Setting> {
    let signaled = |theme: Theme, appearance: &Appearance| {
        let mut signaled = looks(theme, appearance);
        signaled.extend(gnome_looks(theme, appearance));
        signaled.extend(
            named(appearance)
                .into_iter()
                .map(|(key, set, unset)| (INTERFACE, key, set.unwrap_or(unset))),
        );
        signaled
    };
    signaled(was_theme, was)
        .into_iter()
        .zip(signaled(theme, now))
        .filter(|((_, _, before), (_, _, after))| before != after)
        .map(|(_, after)| after)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_config::{AccentColor, Contrast};

    fn string(text: &str) -> OwnedValue {
        OwnedValue::try_from(Value::from(text)).expect("a string")
    }

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
                ..Appearance::default()
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
    fn the_shell_is_told_the_same_look() {
        let told = domicile_protocol::Appearance::from(&Appearance {
            accent_color: Some(AccentColor([0xff, 0x33, 0x0a])),
            contrast: Contrast::High,
            reduced_motion: true,
            ..Appearance::default()
        });

        assert_eq!(
            told,
            domicile_protocol::Appearance {
                accent_color: Some("#ff330a".into()),
                high_contrast: true,
                reduced_motion: true,
            }
        );
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
            ..was.clone()
        };

        assert_eq!(
            moved(Theme::Dark, &was, Theme::Dark, &now),
            [
                (NAMESPACE, "reduced-motion", OwnedValue::from(1u32)),
                (INTERFACE, ENABLE_ANIMATIONS, OwnedValue::from(false)),
            ]
        );
        assert_eq!(
            moved(Theme::Dark, &was, Theme::Light, &was),
            [
                (NAMESPACE, COLOR_SCHEME, OwnedValue::from(2u32)),
                (INTERFACE, COLOR_SCHEME, string("prefer-light")),
            ]
        );
    }

    #[test]
    fn the_icon_theme_is_gnomes_interface_setting() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance {
                icon_theme: Some("Papirus".into()),
                ..Appearance::default()
            },
        };

        assert_eq!(
            settings.read_one(INTERFACE, ICON_THEME),
            Ok(string("Papirus"))
        );
        assert_eq!(settings.read_all(Vec::new()).len(), 2);
    }

    #[test]
    fn no_icon_theme_is_left_to_the_next_backend() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance::default(),
        };

        assert!(settings.read_one(INTERFACE, ICON_THEME).is_err());
        assert!(!settings.read_all(vec![INTERFACE.to_string()])[INTERFACE].contains_key(ICON_THEME));
    }

    #[test]
    fn an_icon_theme_unset_by_a_reload_is_hicolor() {
        let was = Appearance::default();
        let now = Appearance {
            icon_theme: Some("Papirus".into()),
            ..Appearance::default()
        };

        assert_eq!(
            moved(Theme::Dark, &was, Theme::Dark, &now),
            [(INTERFACE, ICON_THEME, string("Papirus"))]
        );
        assert_eq!(
            moved(Theme::Dark, &now, Theme::Dark, &was),
            [(INTERFACE, ICON_THEME, string("hicolor"))]
        );
    }

    #[test]
    fn the_cursor_and_fonts_are_gnomes_interface_settings() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance {
                cursor_theme: Some("Bibata-Modern-Ice".into()),
                cursor_size: Some(32),
                font_name: Some("Inter 11".into()),
                monospace_font_name: Some("Iosevka 12".into()),
                ..Appearance::default()
            },
        };

        assert_eq!(
            settings.read_one(INTERFACE, CURSOR_THEME),
            Ok(string("Bibata-Modern-Ice"))
        );
        // GNOME's schema types the size `i`.
        assert_eq!(
            settings.read_one(INTERFACE, CURSOR_SIZE),
            Ok(OwnedValue::from(32i32))
        );
        assert_eq!(
            settings.read_one(INTERFACE, FONT_NAME),
            Ok(string("Inter 11"))
        );
        assert_eq!(
            settings.read_one(INTERFACE, MONOSPACE_FONT_NAME),
            Ok(string("Iosevka 12"))
        );
    }

    #[test]
    fn no_cursor_or_fonts_are_left_to_the_next_backend() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance::default(),
        };

        for key in [CURSOR_THEME, CURSOR_SIZE, FONT_NAME, MONOSPACE_FONT_NAME] {
            assert!(settings.read_one(INTERFACE, key).is_err(), "{key}");
        }
    }

    #[test]
    fn a_cursor_and_fonts_unset_by_a_reload_are_the_toolkit_defaults() {
        let was = Appearance {
            cursor_theme: Some("Bibata-Modern-Ice".into()),
            cursor_size: Some(32),
            font_name: Some("Inter 11".into()),
            monospace_font_name: Some("Iosevka 12".into()),
            ..Appearance::default()
        };

        assert_eq!(
            moved(Theme::Dark, &was, Theme::Dark, &Appearance::default()),
            [
                (INTERFACE, CURSOR_THEME, string("default")),
                (INTERFACE, CURSOR_SIZE, OwnedValue::from(24i32)),
                (INTERFACE, FONT_NAME, string("Sans 10")),
                (INTERFACE, MONOSPACE_FONT_NAME, string("Monospace 10")),
            ]
        );
    }

    #[test]
    fn gnome_reads_the_theme_and_motion_from_its_interface_settings() {
        let settings = Settings {
            theme: Theme::Dark,
            appearance: Appearance {
                reduced_motion: true,
                ..Appearance::default()
            },
        };

        assert_eq!(
            settings.read_one(INTERFACE, COLOR_SCHEME),
            Ok(string("prefer-dark"))
        );
        assert_eq!(
            settings.read_one(INTERFACE, ENABLE_ANIMATIONS),
            Ok(OwnedValue::from(false))
        );
        assert_eq!(
            settings.read_all(vec![INTERFACE.to_string()])[INTERFACE].len(),
            2
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
        assert!(wants(NAMESPACE, &[]));
    }

    #[test]
    fn a_question_naming_this_namespace_wants_it() {
        assert!(wants(NAMESPACE, &[NAMESPACE.to_string()]));
    }

    #[test]
    fn a_question_naming_a_prefix_of_it_wants_it() {
        // The spec matches dotted-name prefixes.
        assert!(wants(NAMESPACE, &["org.freedesktop".to_string()]));
    }

    #[test]
    fn a_prefix_that_is_not_a_dotted_one_does_not_want_it() {
        // A string prefix that ends mid-component does not match.
        assert!(!wants(NAMESPACE, &["org.freedesktop.appear".to_string()]));
    }

    #[test]
    fn a_question_about_somebody_elses_settings_does_not_want_it() {
        assert!(!wants(NAMESPACE, &["org.kde.kdeglobals".to_string()]));
    }
}
