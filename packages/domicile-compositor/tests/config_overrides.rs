//! Temporary changes to the config: laid over the file, taken up as an edit of
//! it is, ended by a reset or by the file changing that setting.

mod running;

use std::time::Duration;

use std::io::{BufRead as _, BufReader};

use domicile_launch::compositor_socket::{config_overrides, theme, watch};
use domicile_protocol::{ChromeMessage, ConfigKey, ConfigOverride, HostMessage, Theme, WatchTopic};

use crate::running::Compositor;

const LIGHT: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "mode": "light" }
}
"#;

const PATIENCE: Duration = Duration::from_secs(10);

fn mode() -> Vec<ConfigKey> {
    vec![
        ConfigKey::Name("theme".into()),
        ConfigKey::Name("mode".into()),
    ]
}

fn dark() -> ChromeMessage {
    ChromeMessage::SetConfigOverride {
        path: mode(),
        value: r#""dark""#.into(),
    }
}

#[test]
fn a_temporary_change_reaches_the_desktop_until_it_is_reset() {
    let compositor = Compositor::started_with(LIGHT);
    let mut chrome = compositor.chrome();

    assert_eq!(
        config_overrides(compositor.socket(), dark(), Some(PATIENCE)),
        Ok(vec![ConfigOverride {
            path: mode(),
            value: r#""dark""#.into(),
            written: r#""light""#.into()
        }])
    );
    chrome
        .wait_for(|message| *message == HostMessage::Theme { theme: Theme::Dark })
        .expect("the shell hears the changed mode, as from an edit of the file");

    assert_eq!(
        config_overrides(
            compositor.socket(),
            ChromeMessage::ResetConfigOverrides {
                paths: vec![mode()]
            },
            Some(PATIENCE)
        ),
        Ok(Vec::new())
    );
    assert_eq!(
        theme(compositor.socket(), None, Some(PATIENCE)),
        Ok(Theme::Light),
        "a reset goes back to the file's"
    );
}

#[test]
fn the_shells_theme_toggle_is_a_temporary_change_an_edit_ends() {
    let compositor = Compositor::started_with(LIGHT);
    theme(compositor.socket(), Some(Theme::Dark), Some(PATIENCE)).unwrap();
    assert_eq!(
        config_overrides(
            compositor.socket(),
            ChromeMessage::WhichConfigOverrides,
            Some(PATIENCE)
        )
        .map(|overrides| overrides.len()),
        Ok(1),
        "Settings sees the toggle's change"
    );

    compositor.reconfigure(
        r#"{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "mode": "dark" }
}"#,
    );
    // The reload follows the save by a moment, so ask until it lands.
    let until = std::time::Instant::now() + PATIENCE;
    while config_overrides(
        compositor.socket(),
        ChromeMessage::WhichConfigOverrides,
        Some(PATIENCE),
    ) != Ok(Vec::new())
    {
        assert!(
            std::time::Instant::now() < until,
            "the file's own change of the mode ends it"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_change_the_config_would_refuse_is_refused() {
    let compositor = Compositor::started_with(LIGHT);
    let refused = config_overrides(
        compositor.socket(),
        ChromeMessage::SetConfigOverride {
            path: mode(),
            value: r#""purple""#.into(),
        },
        Some(PATIENCE),
    );
    assert!(refused.is_err(), "{refused:?}");
}

#[test]
fn a_watcher_hears_each_temporary_change() {
    let compositor = Compositor::started_with(LIGHT);
    let watching = watch(compositor.socket(), &[WatchTopic::ConfigOverrides]).unwrap();
    watching.set_read_timeout(Some(PATIENCE)).unwrap();
    let mut heard = BufReader::new(watching).lines();
    let mut next = || -> HostMessage {
        serde_json::from_str(&heard.next().expect("the watch says more").unwrap()).unwrap()
    };
    assert_eq!(
        next(),
        HostMessage::ConfigOverrides {
            overrides: Vec::new(),
            refused: None
        },
        "the changes as they stand"
    );
    theme(compositor.socket(), Some(Theme::Dark), Some(PATIENCE)).unwrap();
    assert!(
        matches!(next(), HostMessage::ConfigOverrides { overrides, .. } if overrides.len() == 1),
        "the shell's toggle is heard"
    );
}

#[test]
fn the_locks_settings_take_no_temporary_change() {
    let compositor = Compositor::started_with(LIGHT);
    for path in [
        vec![
            ConfigKey::Name("lock".into()),
            ConfigKey::Name("pam_service".into()),
        ],
        Vec::new(),
    ] {
        let refused = config_overrides(
            compositor.socket(),
            ChromeMessage::SetConfigOverride {
                path,
                value: r#""login""#.into(),
            },
            Some(PATIENCE),
        );
        assert!(refused.is_err(), "{refused:?}");
    }
}
