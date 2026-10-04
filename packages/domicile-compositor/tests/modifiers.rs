//! What a chrome is told about the modifiers, and when.
//!
//! `wl_keyboard.modifiers` goes only to the surface with the keyboard, so a
//! chrome stops hearing about a held Alt once a window is focused. That is
//! when a shell needs it, to start an alt-drag. So the compositor broadcasts
//! modifier changes to every chrome.
//!
//! `Modifiers::moved_to` is unit-tested; these tests cover the call site.
//! `tests/stuck_keys.rs` covers the release on reload from the client's side.
//!
//! No client or display is needed: keys go in and the result comes out over
//! the chrome socket.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// Left Alt, left Ctrl and Enter, in the evdev codes a chrome sends.
const ALT: u32 = 56;
const CTRL: u32 = 29;
const ENTER: u32 = 28;

/// The app id on a key a chrome forwards.
///
/// The compositor ignores it and sends the key to whatever holds the keyboard.
const WHOEVER_HOLDS_IT: &str = "app-1";

/// Alt held, and nothing else.
const HELD: HostMessage = HostMessage::Modifiers {
    alt: true,
    ctrl: false,
    shift: false,
    logo: false,
};

/// Alt and Ctrl together, for telling "still held" from "released and
/// re-pressed".
const BOTH: HostMessage = HostMessage::Modifiers {
    alt: true,
    ctrl: true,
    shift: false,
    logo: false,
};

/// Nothing held.
const LET_GO: HostMessage = HostMessage::Modifiers {
    alt: false,
    ctrl: false,
    shift: false,
    logo: false,
};

fn key(chrome: &mut domicile_test_chrome::Chrome, keycode: u32, pressed: bool) {
    chrome
        .say(&ChromeMessage::Key {
            app_id: WHOEVER_HOLDS_IT.to_string(),
            keycode,
            pressed,
        })
        .expect("the chrome socket takes a key");
}

/// A modifier going down is a message, and so is letting go.
///
/// One test, because a page told only about the press would hold the
/// modifier forever.
#[test]
fn a_modifier_going_down_and_coming_up_are_both_messages() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    // A second chrome that sends nothing, to show this is a broadcast and not
    // a reply to the sender.
    let mut listening = compositor.chrome();

    key(&mut chrome, ALT, true);
    let held = chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("a modifier going down is a message");
    assert_eq!(held, HELD, "alt was pressed and nothing else was");
    assert_eq!(
        listening
            .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
            .expect("a chrome that sent nothing is told about the modifiers too"),
        HELD,
        "the modifiers reached only the page that sent the key"
    );

    key(&mut chrome, ALT, false);
    let let_go = chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("letting go of a modifier is a message too");
    assert_eq!(
        let_go, LET_GO,
        "alt was the only thing held, and it was let go"
    );
}

/// The ordinary keys pressed while a modifier is held say nothing.
///
/// A message on every keystroke would make a shell redraw its alt-drag hint on
/// each one.
#[test]
fn an_ordinary_key_pressed_while_a_modifier_is_held_says_nothing() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    key(&mut chrome, ALT, true);
    chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("a modifier going down is a message");

    key(&mut chrome, ENTER, true);
    key(&mut chrome, ENTER, false);

    // No sleep needed: messages are ordered and `Chrome::wait_for` returns the
    // next match, so a message caused by the Enter would come before the
    // release.
    key(&mut chrome, ALT, false);
    let next = chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("letting go of a modifier is a message");
    assert_eq!(
        next, LET_GO,
        "the next thing said after alt went down was not the release, so the \
         Enter in between was reported"
    );
}

/// A chrome that reloads holding a modifier has it released, and is told.
///
/// Otherwise the page would drag the next window clicked. A reload is when
/// nobody sends the release, because the page that would have is gone.
///
/// The reload is a second `hello`, not a dropped connection: a page sends
/// `hello` when it starts, whatever happened to the socket.
/// `release_pressed_keys` runs on `hello` and on `WinitEvent::Focus(false)`,
/// never on a dropped socket.
///
/// The `focus_chrome` and Ctrl press in the middle catch a compositor that
/// releases keys on every chrome message: it would report Ctrl alone rather
/// than both.
#[test]
fn a_chrome_that_reloads_holding_a_modifier_has_it_released() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    key(&mut chrome, ALT, true);
    let held = chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("a modifier going down is a message");
    assert_eq!(
        held, HELD,
        "nothing was holding a modifier across the reload, so what the \
         assertion below is about was never set up"
    );

    // A non-`hello` message, then a second modifier. A compositor that
    // releases on any message drops the Alt here.
    chrome
        .say(&ChromeMessage::FocusChrome)
        .expect("the chrome socket takes a focus");
    key(&mut chrome, CTRL, true);
    let both = chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("a second modifier going down is a message");
    assert_eq!(
        both, BOTH,
        "alt was let go by something that was not a reload, so the reload \
         below proves nothing about the reload"
    );

    chrome
        .say(&ChromeMessage::Hello {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
        })
        .expect("the chrome socket takes a second hello");

    let after = chrome
        .wait_for(|message| matches!(message, HostMessage::Modifiers { .. }))
        .expect("a page that reloaded is told the keys it was holding are let go");
    assert_eq!(
        after, LET_GO,
        "a chrome that reloaded holding alt was left believing it is still \
         held, and will drag the next window the user clicks"
    );
}
