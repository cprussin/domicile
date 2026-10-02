//! The keys a config binds, resolved on its keyboard and told to the chrome.
//!
//! `shell_config`'s unit tests hold the resolution. What needs a real
//! compositor is the delivery: with the handshake, again when the file is
//! edited, and not at all when the edit names a keysym the keyboard cannot
//! type — which leaves the shells the keys they had.

mod running;

use domicile_protocol::{HostMessage, KeyAction, KeyBinding, Shortcut};

use crate::running::Compositor;

/// A dvp desk with one key bound, and an option for one shell.
///
/// `dvp` because `parenleft` is a different key there than on the default
/// `us`, so the key on the wire can only have come from resolving it on the
/// keyboard this file names.
const A_DVP_DESK: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[input.keyboard]
xkb_variant = "dvp"

[keybindings]
"Meta+Shift+parenleft" = "send-shell workspace 1"

[shells.manganese.options]
gaps = 8
"#;

/// The same desk, with the binding moved to another key.
const THE_SAME_DESK_REBOUND: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[input.keyboard]
xkb_variant = "dvp"

[keybindings]
"Meta+Return" = "send-shell terminal"

[shells.manganese.options]
gaps = 8
"#;

/// The same desk with a typo in a keysym, which parses and resolves to
/// nothing.
const THE_SAME_DESK_MISTYPED: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[input.keyboard]
xkb_variant = "dvp"

[keybindings]
"Meta+Retrun" = "send-shell terminal"
"#;

/// `5` and Enter, as evdev numbers them. On `dvp` the first is `parenleft`.
const KEY_5: u32 = 6;
const KEY_ENTER: u32 = 28;

fn shell_config(message: &HostMessage) -> bool {
    matches!(message, HostMessage::ShellConfig { .. })
}

/// The bindings in mode `default` of a `shell_config`.
fn default_mode(message: HostMessage) -> Vec<KeyBinding> {
    let HostMessage::ShellConfig {
        mut keybindings, ..
    } = message
    else {
        unreachable!("the wait matched on the variant");
    };
    keybindings
        .remove("default")
        .expect("`default` is always there")
}

#[test]
fn the_keys_the_config_binds_reach_the_chrome_on_its_keyboard() {
    let compositor = Compositor::started_with(A_DVP_DESK);
    let mut chrome = compositor.chrome();

    let told = chrome
        .wait_for(shell_config)
        .expect("the keys ride with the handshake");

    let HostMessage::ShellConfig {
        keybindings,
        shells,
    } = told
    else {
        unreachable!("the wait matched on the variant");
    };
    assert_eq!(
        keybindings["default"],
        [KeyBinding {
            shortcut: Shortcut {
                key: KEY_5,
                alt: false,
                ctrl: false,
                shift: true,
                logo: true,
            },
            action: KeyAction::SendShell {
                args: vec!["workspace".into(), "1".into()],
            },
        }]
    );
    assert_eq!(shells["manganese"].options["gaps"], 8);
}

#[test]
fn a_binding_edited_on_disk_reaches_the_chrome() {
    let compositor = Compositor::started_with(A_DVP_DESK);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(shell_config)
        .expect("the keys ride with the handshake");

    compositor.reconfigure(THE_SAME_DESK_REBOUND);

    let told = chrome
        .wait_for(shell_config)
        .expect("the chrome is told the keys the reload bound");
    assert_eq!(
        default_mode(told)
            .iter()
            .map(|binding| binding.shortcut.key)
            .collect::<Vec<_>>(),
        [KEY_ENTER],
        "the binding the file now names, and not the one it replaced"
    );
}

/// A keysym the reloaded config cannot resolve leaves the shells the keys
/// they have.
///
/// `a_keymap_the_reload_cannot_compile_leaves_the_desktop_typing`'s rule, for
/// the keys: the desk is running, and a typo mid-edit is not worth every
/// binding a shell has. Asserted by what a chrome connecting afterward is
/// told, because a compositor that logged the refusal and then retained
/// nothing would pass a check that only read its complaint.
#[test]
fn a_keysym_the_reload_cannot_resolve_leaves_the_shells_their_keys() {
    let compositor = Compositor::started_with(A_DVP_DESK);

    compositor.reconfigure(THE_SAME_DESK_MISTYPED);

    compositor.wait_for_log("keeping the keys the shells were last told");
    assert!(
        compositor.complaint().contains("Retrun"),
        "the refusal names the keysym:\n{}",
        compositor.complaint()
    );
    let mut chrome = compositor.chrome();
    let told = chrome
        .wait_for(shell_config)
        .expect("a chrome that connects after the bad edit is told the keys");
    assert_eq!(
        default_mode(told)
            .iter()
            .map(|binding| binding.shortcut.key)
            .collect::<Vec<_>>(),
        [KEY_5],
        "the retained keys are the last ones that resolved"
    );
}
