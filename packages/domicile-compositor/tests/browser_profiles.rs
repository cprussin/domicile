//! Tests that the config's browser profiles reach the chrome and follow edits.

mod running;

use domicile_protocol::HostMessage;

use crate::running::Compositor;

const A_WORK_PROFILE: &str = r##"
{
  "browser": {
    "profiles": {
      "default": { "name": "Personal", "color": "#0d9488" },
      "work": { "name": "Work", "color": "#d97706" },
      "private": { "name": "Private", "color": "#a78bfa", "private": true }
    },
    "sites": { "github.com/acme": "work" }
  },
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] }
}
"##;

const NO_PROFILES: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] }
}
"#;

/// The profile ids and sites in a `browser_profiles` message.
fn ids_and_sites(message: &HostMessage) -> Option<(Vec<String>, Vec<String>)> {
    match message {
        HostMessage::BrowserProfiles {
            profiles, sites, ..
        } => Some((
            profiles.iter().map(|profile| profile.id.clone()).collect(),
            sites.keys().cloned().collect(),
        )),
        _ => None,
    }
}

#[test]
fn the_configs_browser_profiles_reach_the_chrome_and_follow_an_edit() {
    let compositor = Compositor::started_with(A_WORK_PROFILE);
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| {
            ids_and_sites(message)
                == Some((
                    vec!["default".into(), "private".into(), "work".into()],
                    vec!["github.com/acme".into()],
                ))
        })
        .expect("the profiles ride with the handshake");

    compositor.reconfigure(NO_PROFILES);

    chrome
        .wait_for(|message| {
            ids_and_sites(message) == Some((vec!["default".into(), "private".into()], vec![]))
        })
        .expect("an edit sends the profiles again");
}

#[test]
fn the_chrome_gets_the_profiles_in_the_configs_order() {
    let ordered = A_WORK_PROFILE.replace(
        r#""sites": {"#,
        r#""order": ["work", "default"], "sites": {"#,
    );
    let compositor = Compositor::started_with(&ordered);
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| {
            ids_and_sites(message).map(|(ids, _)| ids)
                == Some(vec!["work".into(), "default".into(), "private".into()])
        })
        .expect("the profiles come in the config's order, then the rest by id");
}

#[test]
fn the_chrome_gets_each_profiles_ad_blocking_and_the_block_lists() {
    use domicile_protocol::AdBlocking;
    let compositor = Compositor::started_with(&A_WORK_PROFILE.replace(
        r#""sites": {"#,
        r#""block_rules": ["||ads.example^"], "sites": {"#,
    ));
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| match message {
            HostMessage::BrowserProfiles {
                profiles,
                block_lists,
                block_rules,
                ..
            } => {
                let mode = |id: &str| {
                    profiles
                        .iter()
                        .find(|profile| profile.id == id)
                        .map(|profile| profile.protections.block_ads_and_trackers)
                };
                mode("default") == Some(AdBlocking::Standard)
                    && mode("private") == Some(AdBlocking::Strict)
                    && block_lists.len() == domicile_config::DEFAULT_BLOCK_LISTS.len()
                    && block_rules == &["||ads.example^"]
            }
            _ => false,
        })
        .expect("a private profile blocks on strict, and the lists ride along");
}
