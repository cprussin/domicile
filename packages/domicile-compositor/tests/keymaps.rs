//! Switching between the config's keymaps through the page's system calls.
//!
//! A switch retypes the whole desktop: every client's `wl_keyboard`, the
//! browser process and the shell's keybindings. It lasts until the desktop
//! restarts.

mod running;

use domicile_protocol::{
    ChromeMessage, HostMessage, KeymapChoice, ListedKeymap, SystemErrorKind, SystemEvent,
    SystemReply, SystemRequest,
};
use smithay::input::keyboard::xkb;

use crate::running::Compositor;

/// Dvorak, then plain US.
const TWO_KEYMAPS: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "keymaps": [
    { "name": "dvorak", "xkb_variant": "dvorak" },
    { "name": "us" }
  ] } }
}
"#;

/// [`TWO_KEYMAPS`] with German added between them.
const THREE_KEYMAPS: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "keymaps": [
    { "name": "dvorak", "xkb_variant": "dvorak" },
    { "name": "de", "xkb_layout": "de" },
    { "name": "us" }
  ] } }
}
"#;

/// A keyboard with no `keymaps`.
const ONE_KEYMAP: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "xkb_variant": "dvorak" } }
}
"#;

#[test]
fn the_shell_hears_the_keymaps_and_the_one_the_desktop_starts_on() {
    let compositor = Compositor::started_with(TWO_KEYMAPS);
    let mut chrome = compositor.chrome();

    assert_eq!(
        listen_described(&mut chrome, 1),
        (
            vec![
                ListedKeymap {
                    name: "dvorak".into(),
                    description: Some("English (Dvorak)".into()),
                },
                ListedKeymap {
                    name: "us".into(),
                    description: Some("English (US)".into()),
                },
            ],
            "dvorak".into()
        ),
        "each keymap carries xkb's name for its layout"
    );
}

#[test]
fn a_keyboard_without_keymaps_is_one_keymap() {
    let compositor = Compositor::started_with(ONE_KEYMAP);
    let mut chrome = compositor.chrome();

    assert_eq!(
        listen(&mut chrome, 1),
        (vec!["dvorak".into()], "dvorak".into())
    );
}

#[test]
fn a_switch_retypes_the_clients_the_browser_and_the_shell() {
    let compositor = Compositor::started_with(TWO_KEYMAPS);
    let mut typing = compositor.client("typing");
    assert!(
        typing.wait_for_trace("keymap(", 1),
        "a client binds a keyboard and is handed a keymap:\n{}",
        typing.trace()
    );
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("the keymap rides with the handshake");
    let started = keys(&mut chrome);
    listen(&mut chrome, 1);

    assert_eq!(select(&mut chrome, 2, KeymapChoice::Next), SystemReply::Set);

    assert_eq!(heard(&mut chrome, 1), "us", "the shell hears the switch");
    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("the browser is told the new keymap");
    let HostMessage::Keymap { keymap } = told else {
        unreachable!("the wait matched on the variant");
    };
    assert_eq!(layout_name(&keymap), "English (US)");
    assert!(
        typing.wait_for_trace("keymap(", 2),
        "the client is handed the new keymap:\n{}",
        typing.trace()
    );
    assert!(
        typing
            .trace()
            .rsplit("keymap(")
            .next()
            .unwrap()
            .starts_with("English (US)"),
        "and it is the new layout:\n{}",
        typing.trace()
    );
    let now = keys(&mut chrome);
    assert_ne!(
        started.get("l"),
        now.get("l"),
        "the shell's chords resolve on the new layout"
    );

    assert_eq!(
        select(
            &mut chrome,
            3,
            KeymapChoice::Named {
                name: "dvorak".into()
            }
        ),
        SystemReply::Set
    );
    assert_eq!(heard(&mut chrome, 1), "dvorak", "a name picks its keymap");
}

#[test]
fn a_keymap_the_config_does_not_have_is_not_found() {
    let compositor = Compositor::started_with(TWO_KEYMAPS);
    let mut chrome = compositor.chrome();

    let SystemReply::Failed { error } =
        select(&mut chrome, 1, KeymapChoice::Named { name: "fr".into() })
    else {
        panic!("an unknown keymap is refused");
    };
    assert_eq!(error.kind, SystemErrorKind::NotFound);
}

#[test]
fn a_reload_keeps_the_keymap_the_desktop_switched_to() {
    let compositor = Compositor::started_with(TWO_KEYMAPS);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 1);
    select(&mut chrome, 2, KeymapChoice::Next);
    assert_eq!(heard(&mut chrome, 1), "us");

    compositor.reconfigure(THREE_KEYMAPS);

    assert_eq!(
        heard_list(&mut chrome, 1),
        (vec!["dvorak".into(), "de".into(), "us".into()], "us".into())
    );
    assert_eq!(
        heard_after_next(&mut chrome),
        "dvorak",
        "and next wraps from it"
    );
}

#[test]
fn a_reload_that_drops_the_active_keymap_goes_back_to_the_first() {
    let compositor = Compositor::started_with(TWO_KEYMAPS);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 1);
    select(&mut chrome, 2, KeymapChoice::Next);
    assert_eq!(heard(&mut chrome, 1), "us");

    compositor.reconfigure(ONE_KEYMAP);

    assert_eq!(
        heard_list(&mut chrome, 1),
        (vec!["dvorak".into()], "dvorak".into())
    );
}

/// Listen for the keymaps under `id`, and return the names in the first
/// list heard.
fn listen(chrome: &mut domicile_test_chrome::Chrome, id: u32) -> (Vec<String>, String) {
    let (keymaps, active) = listen_described(chrome, id);
    (names(keymaps), active)
}

/// Listen for the keymaps under `id`, and return the first list heard.
fn listen_described(
    chrome: &mut domicile_test_chrome::Chrome,
    id: u32,
) -> (Vec<ListedKeymap>, String) {
    chrome
        .say(&ChromeMessage::SystemRequest {
            id,
            request: SystemRequest::Keymaps,
        })
        .expect("the chrome socket takes a system call");
    let replied = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemReply { id: of, .. } if *of == id))
        .expect("a system call is answered");
    assert!(
        matches!(
            replied,
            HostMessage::SystemReply {
                reply: SystemReply::Started,
                ..
            }
        ),
        "{replied:?}"
    );
    heard_described(chrome, id)
}

/// The names in the next keymap list heard under `id`.
fn heard_list(chrome: &mut domicile_test_chrome::Chrome, id: u32) -> (Vec<String>, String) {
    let (keymaps, active) = heard_described(chrome, id);
    (names(keymaps), active)
}

fn names(keymaps: Vec<ListedKeymap>) -> Vec<String> {
    keymaps.into_iter().map(|keymap| keymap.name).collect()
}

/// The next keymap list heard under `id`.
fn heard_described(
    chrome: &mut domicile_test_chrome::Chrome,
    id: u32,
) -> (Vec<ListedKeymap>, String) {
    let told = chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent { id: of, event: SystemEvent::Keymaps { .. } } if *of == id
            )
        })
        .expect("the keymaps are told");
    let HostMessage::SystemEvent {
        event: SystemEvent::Keymaps { keymaps, active },
        ..
    } = told
    else {
        unreachable!("the wait matched on the variant");
    };
    (keymaps, active)
}

/// The active keymap's name in the next list heard under `id`.
fn heard(chrome: &mut domicile_test_chrome::Chrome, id: u32) -> String {
    heard_list(chrome, id).1
}

/// Switch to the next keymap, and return the one heard under id 1.
fn heard_after_next(chrome: &mut domicile_test_chrome::Chrome) -> String {
    select(chrome, 9, KeymapChoice::Next);
    heard(chrome, 1)
}

fn select(chrome: &mut domicile_test_chrome::Chrome, id: u32, keymap: KeymapChoice) -> SystemReply {
    chrome
        .say(&ChromeMessage::SystemRequest {
            id,
            request: SystemRequest::SelectKeymap { keymap },
        })
        .expect("the chrome socket takes a system call");
    let replied = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemReply { id: of, .. } if *of == id))
        .expect("a system call is answered");
    let HostMessage::SystemReply { reply, .. } = replied else {
        unreachable!("the wait matched on this variant")
    };
    reply
}

/// The keysym-to-key map in the next shell config the chrome is told.
fn keys(chrome: &mut domicile_test_chrome::Chrome) -> std::collections::BTreeMap<String, u32> {
    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::ShellConfig { .. }))
        .expect("the shell config is told");
    let HostMessage::ShellConfig { keys, .. } = told else {
        unreachable!("the wait matched on the variant");
    };
    keys
}

/// The name of the first layout of `keymap`, such as `English (Dvorak)`.
fn layout_name(keymap: &str) -> String {
    let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    xkb::Keymap::new_from_string(
        &context,
        keymap.to_string(),
        xkb::KEYMAP_FORMAT_TEXT_V1,
        xkb::KEYMAP_COMPILE_NO_FLAGS,
    )
    .expect("xkb reads the keymap the chrome was sent")
    .layout_get_name(0)
    .to_string()
}
