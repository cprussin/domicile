//! Tests that the config's sites to force dark reach the chrome and follow
//! edits.

mod running;

use domicile_protocol::HostMessage;

use crate::running::Compositor;

const GMAIL_FORCED_DARK: &str = r#"
{
  "theme": { "force_dark": ["mail.google.com"] },
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] }
}
"#;

const NOTHING_FORCED_DARK: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] }
}
"#;

#[test]
fn the_sites_the_config_forces_dark_reach_the_chrome_and_follow_an_edit() {
    let compositor = Compositor::started_with(GMAIL_FORCED_DARK);
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| {
            *message
                == HostMessage::ForceDark {
                    sites: vec!["mail.google.com".into()],
                }
        })
        .expect("the sites ride with the handshake");

    compositor.reconfigure(NOTHING_FORCED_DARK);

    chrome
        .wait_for(|message| *message == HostMessage::ForceDark { sites: vec![] })
        .expect("a connected chrome is told the list the edit names");
}
