//! The extensions a desk's config names reach the browser process, and follow
//! an edit.
//!
//! `domicile_host`'s tests hold where the message sits in the handshake and
//! `restatement`'s hold when a reload moves it. What needs a real compositor
//! is that the config it was started on and the file it is watching are the
//! lists it tells — see `docs/architecture/EXTENSIONS.md`.

mod running;

use domicile_protocol::HostMessage;

use crate::running::Compositor;

const ONE_EXTENSION: &str = r#"
[extensions]
web_store = ["ddkjiahejlhfcafbddmgiahcphecmpfh"]

[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

const AN_UNPACKED_EXTENSION: &str = r#"
[extensions]
unpacked = ["/home/you/src/my-extension"]

[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

#[test]
fn the_extensions_the_config_names_reach_the_chrome_and_follow_an_edit() {
    let compositor = Compositor::started_with(ONE_EXTENSION);
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| {
            *message
                == HostMessage::Extensions {
                    web_store: vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".into()],
                    unpacked: vec![],
                }
        })
        .expect("the extensions ride with the handshake");

    compositor.reconfigure(AN_UNPACKED_EXTENSION);

    chrome
        .wait_for(|message| {
            *message
                == HostMessage::Extensions {
                    web_store: vec![],
                    unpacked: vec!["/home/you/src/my-extension".into()],
                }
        })
        .expect("a connected chrome is told the list the edit names");
}

#[test]
fn an_unpacked_extension_under_a_tilde_reaches_the_chrome_under_the_home() {
    // The chrome hands the path to an engine that expands nothing, so the
    // `~` is expanded before it leaves, from the home the compositor runs in.
    let home = tempfile::tempdir().expect("a home");
    let compositor = Compositor::started_in_a_home(
        r#"
[extensions]
unpacked = ["~/src/my-extension"]

[[output.displays]]
name = "left"
size = [1920, 1080]
"#,
        Some(home.path()),
    );
    let mut chrome = compositor.chrome();

    let expanded = home.path().join("src/my-extension").display().to_string();
    chrome
        .wait_for(|message| {
            *message
                == HostMessage::Extensions {
                    web_store: vec![],
                    unpacked: vec![expanded.clone()],
                }
        })
        .expect("the chrome is told the path the tilde stands for");
}
