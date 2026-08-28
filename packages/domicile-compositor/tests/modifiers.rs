//! What a chrome is told about the modifiers, and when.
//!
//! Ported from `scripts/e2e-modifiers.sh`, deleted in the change that added
//! this file.
//!
//! A page cannot see this for itself. `wl_keyboard.modifiers` goes to the
//! surface that holds the keyboard, so the moment a window is focused the
//! chrome stops hearing about the Alt the user is holding — which is exactly
//! when a shell wants to know, because that is when it would begin an
//! alt-drag. So the compositor broadcasts it — to every chrome, not only the
//! one that sent the key, which is what the first test below asserts with a
//! second chrome that sent nothing.
//!
//! # Both claims were uncovered
//!
//! Measured before writing either test, by mutation against the whole
//! workspace:
//!
//! | mutation | before | after |
//! |---|---|---|
//! | `tell_the_chromes_the_modifiers` returns without saying anything | passes | **fails** |
//! | it reports on every key rather than only on a change | passes | **fails** |
//!
//! "Passes" is the entire Rust suite. `Modifiers::moved_to` decides the second
//! of those and is unit-tested on its own; what was not tested is the call
//! site — that the compositor asks it at all, and broadcasts what it answers.
//!
//! Uncovered *here*, that is. `tests/stuck_keys.rs` covers the release on
//! reload from the other side, off a real client's own trace. The two come
//! apart: a compositor that clears the seat but never forwards the release
//! passes this file and fails that one, because
//! `tell_the_chromes_the_modifiers` reads the seat and the seat is clear.
//!
//! # Nothing here needs a client
//!
//! The keys go in over the chrome socket and the verdict comes back out of it,
//! which is what makes this the cheapest check in the suite to have ported: no
//! display, no client, no browser.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// Left Alt, left Ctrl and Enter, in the evdev codes a chrome sends.
const ALT: u32 = 56;
const CTRL: u32 = 29;
const ENTER: u32 = 28;

/// The app id on a key a chrome forwards.
///
/// Ignored by the compositor — the `Key` arm destructures `keycode` and
/// `pressed` and drops the rest, because a key goes to whatever holds the
/// keyboard rather than to the window the page thought it was over. Named here
/// rather than left as a bare string so that the next reader does not go
/// looking for the window it refers to.
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
/// The pair in one test because they are one claim: a page told a modifier
/// went down and never told it came up holds it for ever, so the down on its
/// own is not worth having. The script asserted them as the first two lines of
/// one transcript for the same reason.
#[test]
fn a_modifier_going_down_and_coming_up_are_both_messages() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    // A second chrome, which sends nothing and is told everything. Without it
    // nothing here distinguishes a broadcast from a reply to whichever page
    // sent the key, and "broadcast" is the whole content of the claim — the
    // compositor's own `hello` handling reasons about the two-chrome desktop
    // explicitly, so it is a case the production code has an opinion about.
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
/// The other half of the rule, and the half a chrome notices: a page told on
/// every keystroke is reading a keystroke counter, not a modifier state, and a
/// shell that redraws its alt-drag affordance on each one is doing it sixty
/// times a second while someone types.
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

    // No wait, and none is needed — which was measured rather than assumed. A
    // first version slept 300ms here for a message that should not come; a
    // compositor that reports the Enter is convicted just as reliably without
    // it, because the compositor's loop is ordered and `Chrome::wait_for`
    // hands back the *next* unreturned match rather than any match. So a
    // `modifiers` caused by the Enter is necessarily ahead of the one caused
    // by the alt-up, and asking for the next one and insisting it is the
    // release is the whole check. The sleep cost 300ms a run and bought
    // nothing.
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

/// A chrome that reloads holding a modifier has it let go, and is told.
///
/// The failure with no way back, and the reason this file is worth its
/// seconds. A page that heard Alt go down and never heard it come up drags the
/// next window the user clicks, for as long as it runs — and a reload is
/// exactly the moment nobody sends the release, because the page that would
/// have sent it is gone.
///
/// The reload is a second `hello`, not a dropped connection. That is the
/// signal the compositor actually has: a page sends one when its bundle
/// starts, so it arrives again after a reload or a crash-and-recreate whatever
/// the socket did. A first version of this test dropped the connection
/// instead, on the assumption that a dead peer is what the compositor watches
/// for — it is not, and the test failed against a correct compositor with the
/// held Alt still held. The comment on the `hello` arm says why: a chrome that
/// dies and never comes back leaves the keys down until some page connects.
///
/// `release_pressed_keys` has two call sites — that arm, and
/// `WinitEvent::Focus(false)` in the windowed backend, where the window has
/// stopped receiving keys so the releases are never coming. Neither is a
/// dropped socket. An earlier version of this comment said "the `hello` arm
/// and nowhere else", which was the right conclusion off a wrong reading, and
/// would have sent anyone auditing what can drop a user's held keys past the
/// winit path.
///
/// The `focus_chrome` in the middle is what makes this about the *signal*
/// rather than the timing. Without it a compositor that released the keys on
/// **every** chrome message passed this test and the whole workspace — it
/// released them early, and the reload's own assertion still found the value
/// it wanted. Pressing Ctrl afterwards and expecting *both* is what tells
/// "still held" from "released and re-pressed".
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

    // Something that is not a `hello`, and then a second modifier. A
    // compositor that releases on any message has dropped the Alt here, and
    // reports Ctrl alone below instead of both.
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
