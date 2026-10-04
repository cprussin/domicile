//! Tests that the chrome receives each keysym's key for the configured layout,
//! on connect and after a layout change. Shells use this to bind keys.

mod running;

use domicile_protocol::HostMessage;

use crate::running::Compositor;

const A_DVP_DESK: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "xkb_variant": "dvp" } }
}
"#;

const THE_SAME_DESK_ON_US: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// Evdev codes for `5` and `p`, which carry `parenleft` and `l` on `dvp`.
const KEY_5: u32 = 6;
const KEY_P: u32 = 25;
/// Evdev code for `l` on `us`.
const KEY_L: u32 = 38;

fn shell_config(message: &HostMessage) -> bool {
    matches!(message, HostMessage::ShellConfig { .. })
}

/// The key `keysym` is on, from a `shell_config`.
fn key(message: &HostMessage, keysym: &str) -> Option<u32> {
    let HostMessage::ShellConfig { keys } = message else {
        unreachable!("the wait matched on the variant");
    };
    keys.get(keysym).copied()
}

#[test]
fn the_keyboard_reaches_the_chrome_as_the_config_lays_it_out() {
    let compositor = Compositor::started_with(A_DVP_DESK);
    let mut chrome = compositor.chrome();

    let told = chrome
        .wait_for(shell_config)
        .expect("the keyboard rides with the handshake");

    assert_eq!(key(&told, "parenleft"), Some(KEY_5));
    assert_eq!(key(&told, "l"), Some(KEY_P));
}

#[test]
fn a_layout_edited_on_disk_moves_the_keys() {
    // A shell's `Meta+l` binds the key `l` is on, which a new layout moves.
    let compositor = Compositor::started_with(A_DVP_DESK);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(shell_config)
        .expect("the keyboard rides with the handshake");

    compositor.reconfigure(THE_SAME_DESK_ON_US);

    let told = chrome
        .wait_for(shell_config)
        .expect("the chrome is told the keyboard the reload laid out");
    assert_eq!(key(&told, "l"), Some(KEY_L));
}
