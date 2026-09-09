//! How the compositor tells the desktop from the things running on it.
//!
//! Ported from `scripts/e2e-chrome-layer.sh`, deleted in the change that added
//! this file.
//!
//! The compositor serves two Wayland displays and publishes both. A client that
//! arrives on one becomes a window on the desktop; a client that arrives on the
//! other *is* the desktop. Which socket it came in on is the whole of the
//! distinction — there is no handshake and nothing in the surface to read.
//!
//! Get it wrong in the direction this guards and the chrome mounts an `<app>`
//! element for itself, inside itself. The recursion is the least of it: the
//! desktop becomes a window on the desktop, and every window on it is drawn
//! inside that.
//!
//! # It was uncovered, and strikingly so
//!
//! `is_chrome_surface` rewritten to `false` — every client an app, the
//! distinction gone entirely — **passed the whole Rust suite**. Measured
//! before this file was written. Nothing below the e2e level had an opinion
//! about it, because the classification is a fact about the *connection*, and
//! a unit test has none. It now fails four of the five checks here and nothing
//! anywhere else.
//!
//! # One check was written here and deleted for killing nothing
//!
//! `the_compositor_says_it_recognised_the_chrome` started a chrome-side client
//! and waited for `the chrome mapped its toplevel`, arguing that the check
//! above reads what the *host was told* and this reads what the compositor
//! *decided*. The second half is true and not of this check uniquely: its
//! whole body is a strict prefix of four of the five checks below, each of
//! which waits on the same line as its own premise. So every mutation that
//! fails it fails those too — re-added under `is_chrome_surface` forced to
//! `false`, it failed alongside exactly the four that fail without it — and it
//! cost a compositor start and a real client start to say nothing new. Same
//! rule `stuck_keys.rs` applies to its own deleted lock check.
//!
//! Headless on purpose: what is under test happens before anything is drawn.
//! Whether the chrome's pixels land over the apps needs a display, and the
//! only thing that has one is a desktop actually running.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage, Shortcut};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// Tab and `a`, in the evdev codes a chrome sends.
const TAB: u32 = 15;
const KEY_A: u32 = 30;

/// The `app_id` on a `key`, which the compositor discards — see [`key`].
const WHEREVER_THE_KEYBOARD_IS: &str = "wherever-the-keyboard-is";

/// Type one key at whatever holds the keyboard.
///
/// *Whatever holds it*, and not `app_id`: the compositor destructures that
/// field away and `ClientRequest::Key` carries no id at all, so the key goes
/// where the seat's focus is. It is passed because the protocol has the field,
/// and one placeholder is used everywhere so that no reader takes it for a
/// route.
fn key(chrome: &mut domicile_test_chrome::Chrome, keycode: u32, pressed: bool) {
    chrome
        .say(&ChromeMessage::Key {
            app_id: WHEREVER_THE_KEYBOARD_IS.to_string(),
            keycode,
            pressed,
        })
        .expect("the chrome socket takes a key");
}

/// Give the window the keyboard.
///
/// It used to be placed first, because `focus_app` refused an app the chrome
/// had not placed. The gate is the host's own map of apps now, and appearing
/// is what puts an app in it -- but the focus itself still matters here, since
/// a window that is not focused is not the one being tested.
fn focus(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.to_string(),
        })
        .expect("the chrome socket takes a focus");
}

/// A client on the chrome's display is the desktop; one on the apps' display is
/// a window on it.
///
/// Two identical clients — same binary, same arguments but the title — told
/// apart by nothing except which display they opened on. That is what makes
/// this a test of the classification rather than of anything about the clients.
///
/// The discriminator is *which* client the announcement belongs to, and it is
/// reached by way of the name rather than the announcement: `app_appeared` is
/// sent when the toplevel is created and carries no title, because a client
/// names its window in the request after that one. So the announcement says an
/// app exists and `app_titled` says which — and the test needs both.
///
/// The chrome-side client is started, and *waited for*, before the app-side
/// one. That ordering is what makes the failure deterministic rather than a
/// race: with the classification removed the chrome-side client is announced
/// first, so the first `app_appeared` belongs to it and the name that arrives
/// for `app-side` belongs to a different one.
#[test]
fn a_client_on_the_chrome_display_is_the_desktop_rather_than_a_window_on_it() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    // Started and settled first, so that a compositor which announces it
    // announces it first. Waiting on the compositor's own classification
    // rather than on a sleep: this is the moment the decision has been made.
    let _desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");

    let _window = compositor.client("app-side");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id: first, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    let named = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::AppTitled { title: Some(title), .. } if title == "app-side")
        })
        .expect("the client on the apps' display names its window");
    let HostMessage::AppTitled { app_id: named, .. } = named else {
        unreachable!("the wait matched on this variant")
    };

    assert_eq!(
        first, named,
        "the first window announced to the chrome was not the one on the \
         apps' display, so the compositor announced its own desktop as a \
         window on itself"
    );
}

/// A shortcut the chrome claims reaches the compositor.
///
/// The compositor is the only thing that sees a key before its client does, so
/// a claim that never crossed the socket means every desktop shortcut dies the
/// moment a window takes the keyboard.
///
/// # This asserts arrival, not effect, and that is a real limit
///
/// Deleting `self.shortcuts.grab(shortcut)` — keeping the log line above it —
/// passes this test and the whole suite. Measured. So the check pins that the
/// claim was read off the socket and reached the Wayland thread, and nothing
/// more.
///
/// It is not weakness that a stronger version would fix. `ClientRequest::Key`,
/// the path a chrome-injected key takes, forwards unconditionally and never
/// consults `shortcuts`: the filter that intercepts a claimed chord is on
/// `InputEvent::Keyboard`, the *physical* keys Domicile's own window receives.
/// A behavioural test driven over the chrome socket therefore cannot see the
/// interception at all — verified, by writing one: with the chord injected and
/// Alt+Tab claimed, the window is given the Tab, because that path was never
/// filtered.
///
/// So the effect needs a real window and a real keyboard, and it is unit-tested
/// instead — `shortcut.rs` has twelve tests over `grab`, `press`, `release` and
/// `matching`, including that an unclaimed key passes through and that the
/// release of a taken press is taken too. The deleted script said exactly this
/// and was right; what is left for an e2e check is the wiring.
#[test]
fn a_shortcut_the_chrome_claims_reaches_the_compositor() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    chrome
        .say(&ChromeMessage::GrabShortcut {
            shortcut: Shortcut {
                key: TAB,
                alt: true,
                ctrl: false,
                shift: false,
                logo: false,
            },
        })
        .expect("the chrome socket takes a shortcut claim");

    compositor.wait_for_log("the chrome claimed a shortcut");
}

/// Focusing a window that has no surface leaves the keyboard with the chrome.
///
/// The race a real chrome loses whenever a window closes while its own focus
/// message is in flight. Handing the keyboard to nothing is what makes a
/// desktop go permanently deaf, because nothing afterwards takes it back — and
/// the compositor is what has to survive it, since the page cannot know its
/// message was overtaken.
///
/// An app id the host has never seen is the same shape as one whose window has
/// just gone: the host has no such app either way, so it refuses the focus and
/// the seat is told what it settled on. This is the only refusal left — the
/// check above used to be its other end, where a window existed and had not
/// been placed, and placement going took that case with it.
///
/// Asserted by typing, not by the log. The refusal is logged *before* the
/// keyboard is put anywhere, so a version that logs and then hands the seat
/// over regardless keeps the line — measured, on a first version of this
/// test. What matters is that the next key still reaches somebody, and the
/// desktop is the somebody.
#[test]
fn focusing_a_window_that_never_existed_leaves_the_keyboard_with_the_chrome() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");
    let mut chrome = compositor.chrome();

    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: "app-that-went-away".to_string(),
        })
        .expect("the chrome socket takes a focus");
    compositor.wait_for_log("keyboard focus -> a window this compositor does not know");

    key(&mut chrome, KEY_A, true);

    assert!(
        desktop.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "the chrome was focused on a window that does not exist and the next key \
         reached nothing — the desktop has gone deaf. It traced:\n{}",
        desktop.trace()
    );
}

/// A window can take the keyboard the moment it appears.
///
/// This test used to assert the opposite, and the reversal is the point. The
/// scene refused focus for an app the chrome had not placed, while the seat
/// had no such check — `ClientRequest::KeyboardFocus` looks only for a
/// *surface* — so the two answered differently and the keyboard went to a
/// window the page was still marking inactive.
///
/// Two sources of truth disagreeing is what caused that, and there is one now:
/// the host's own map of apps, which `app_appeared` is what puts an app in.
/// So the refusal is gone rather than fixed, and what is left to pin is that
/// the focus lands.
///
/// The case is an ordinary desktop, not a contrived one: `app_appeared`
/// arrives before the element showing the window has been laid out at all, so
/// a shell that focuses a window as it opens asks for exactly this.
///
/// Two assertions, because the line alone would not catch it: a compositor
/// that logs the focus and does not move the seat keeps the line. The key is
/// what says where the keyboard actually is.
#[test]
fn a_window_takes_the_keyboard_before_it_has_been_laid_out() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // The desktop is started and left alone: this check is about where the
    // keyboard went, and it went to the window.
    let _desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");
    let mut chrome = compositor.chrome();

    let mut window = compositor.client("app-side");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    // Focused the instant it appeared, with nothing said about its size --
    // which is all a shell knows about a window at this point.
    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    key(&mut chrome, KEY_A, true);

    assert!(
        window.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "a window focused before it had been laid out never got the keyboard, \
         so a shell that focuses a window as it opens types into nothing. It \
         traced:\n{}",
        window.trace()
    );
}

/// The keyboard comes back to the chrome when the window holding it goes away.
///
/// A keyboard with nowhere to go is a desktop that has stopped listening —
/// working perfectly until you close a window, and then deaf. The chrome will
/// usually ask for it back, but it does not have to, and a client that crashed
/// rather than closed never got the chance. So the compositor guarantees it.
///
/// The wait counts occurrences rather than looking for the line, because the
/// chrome takes the keyboard once already when its own toplevel maps. The
/// interesting one is the second — "and again", after the window went.
///
/// And then a key, because the line is not the thing. A first version stopped
/// at the count, and a compositor whose `focus_chrome` keeps its `info!` and
/// drops the `set_focus` beneath it passed — saying twice that the chrome has
/// the keyboard while leaving the desktop deaf, which is the exact failure
/// this test names. Measured. The line says the compositor decided; the key
/// says it happened.
#[test]
fn the_keyboard_comes_back_to_the_chrome_when_a_window_goes_away() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");
    let mut chrome = compositor.chrome();

    let window = compositor.client("app-side");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    // The window crashes rather than closing: nothing asks for the keyboard
    // back, which is the case the compositor has to survive on its own.
    drop(window);

    compositor.wait_for_log_times("the chrome has the window's keyboard", 2);

    key(&mut chrome, KEY_A, true);
    assert!(
        desktop.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "the window went away and the compositor said the chrome has the \
         keyboard, but the next key reached nothing — the desktop has gone \
         deaf. It traced:\n{}",
        desktop.trace()
    );
}

/// The desktop's own window mapping takes the keyboard back in the brain as
/// well as in the seat.
///
/// `focus_chrome` moves two things: the seat, and — through
/// `broadcast_focus_decision` — the chrome's own idea of what is active. The
/// second is separately droppable, and dropping it leaves `keyboard_target`
/// naming a window the compositor has stopped typing into, with the page still
/// marking it active. It was uncovered: deleting that call passed the whole
/// workspace.
///
/// The check above cannot see it, and that was measured rather than assumed.
/// On the destroy path `toplevel_destroyed` runs `broadcast_closed` first,
/// which has already told the chrome the focus moved — so a `focus_changed`
/// waited for there arrives whether or not the line under test ran.
///
/// This drives another route instead: the desktop's window turning up while an
/// app holds the keyboard, which is a real chrome starting late — the case
/// `a_chrome_that_connects_late_is_told_about_a_window_already_open`
/// (`tests/apps.rs`) is about. `focus_chrome` has three call sites, the
/// destroy path above is the second, and the third is `WinitEvent::Focus(true)`
/// — alt-tabbing in, which needs a real winit window. So this is the one route
/// that can see the line *and* be driven headless. A click on the desktop is
/// not among them at all: `focus_pointed_at` broadcasts the same decision from
/// its own arm and never comes through here.
///
/// The startup `focus_changed` is consumed first. Without that the last wait
/// is answered by the message the compositor sends before any window exists,
/// and passes with the line deleted — which is how a first version of this
/// mis-measured.
#[test]
fn the_desktop_mapping_late_takes_the_keyboard_back_in_the_brain_too() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: None }))
        .expect("the compositor says where the keyboard is when nothing holds it");

    let _window = compositor.client("app-side");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");
    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: Some(_) }))
        .expect("the brain is told the window has the keyboard");

    let _desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");

    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: None }))
        .expect(
            "the desktop's window mapped and took the keyboard, and the chrome was never told \
             — so the page goes on marking a window active that the compositor has stopped \
             typing into",
        );
}
