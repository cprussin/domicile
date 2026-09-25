//! A locked desk does not put what the shell forwards into the seat.
//!
//! `crate::lock` decides what a locked desk refuses and what opens it, and its
//! unit tests own both. What they cannot reach is the thing the lock is *for*:
//! a real Wayland client, on a real seat, not being given a keystroke a real
//! chrome forwarded. That is three processes and Smithay in the middle, so it
//! is a claim about a running compositor and nothing smaller — the same reason
//! `tests/input.rs` exists, which is this file's mirror image: over there the
//! forward reaches the client, and every assertion here is that the same
//! forward does not.
//!
//! The lock is also the one piece of state in this compositor whose whole point
//! is what it survives. A page reload is a second `hello` on a second socket
//! (`Compositor::chrome` says so), so "a shell that reloaded over a locked desk
//! comes back knowing" is a thing a test can actually ask, and it is asked
//! below.
//!
//! What locks a desk is nobody being at it, so every test here arrives at a
//! locked desk through `crate::idle`'s dark edge. The clock is added and then
//! taken away again rather than left running, because a desk that can blank can
//! blank *twice*: a second one a beat after the unlock would re-lock the desk
//! under the assertion that the keys come back, and the test would fail as a
//! timing accident rather than a finding.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage, Passphrase};

use crate::running::Compositor;

/// `a`, in evdev codes — what a chrome forwards. `tests/input.rs` uses the same
/// key, and for the same reason: the client traces `key(serial, time, code,
/// state)`, so the tail of that line names which key and which half of it.
const EVDEV_KEY_A: u32 = 30;

/// What the client's trace says when it was given a press of that key.
const A_PRESS_OF_IT: &str = ", 30, 1)";

/// And the release of it.
const A_RELEASE_OF_IT: &str = ", 30, 0)";

/// The passphrase these desks state, and the one the tests type.
const THE_PASSPHRASE: &str = "open sesame";

/// A desk that can lock and has no clock to lock it.
///
/// The starting point for every test here: the lock exists, so the compositor
/// sends `locked` at all, and nothing has shut it yet.
const A_DESK_THAT_CAN_LOCK: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[lock]
passphrase = "open sesame"
"#;

/// The same desk, with the shortest clock its own config will accept.
///
/// A second because a check should not wait longer than it has to, and
/// `IdleConfig` refuses zero.
const A_DESK_THAT_LOCKS_IN_A_SECOND: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[idle]
blank_after_seconds = 1

[lock]
passphrase = "open sesame"
"#;

/// Bring a desk that can lock to a desk that is locked.
///
/// Through the clock, because that is the only thing that locks a desk today —
/// and then the clock is taken away again, so that the desk under the
/// assertions cannot blank a second time. The wait in between is the compositor
/// saying the state it is in rather than a sleep: `wait_for` consumes the
/// message, so a `locked` from the catch-up on connecting cannot answer for the
/// edge.
///
/// **It takes the caller's chrome rather than opening one.** A second
/// connection is a second `hello`, and a `hello` makes this compositor let go of
/// every key the seat has down — which is exactly what one of the tests below
/// is about. A helper that opened its own would answer that test's question
/// before it was asked.
fn lock_the_desk(compositor: &Compositor, chrome: &mut domicile_test_chrome::Chrome) {
    compositor.reconfigure(A_DESK_THAT_LOCKS_IN_A_SECOND);
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .expect("a desk nobody is at locks itself and says so");

    // And the clock goes away, which also brings the screens back: the desk
    // under every assertion below is lit, locked, and unable to lock again.
    compositor.reconfigure(A_DESK_THAT_CAN_LOCK);
    compositor.wait_for_log("the idle timeout changed while the screens were off");
}

/// Type a key at whichever window has the keyboard, press and release.
fn press_a(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    for pressed in [true, false] {
        say_a(chrome, app_id, pressed);
    }
}

/// One half of that keystroke, for the test that never sends the other.
fn say_a(chrome: &mut domicile_test_chrome::Chrome, app_id: &str, pressed: bool) {
    chrome
        .say(&ChromeMessage::Key {
            app_id: app_id.to_string(),
            keycode: EVDEV_KEY_A,
            pressed,
        })
        .expect("the chrome socket takes input");
}

/// Connect a chrome, start a client and give its window the keyboard.
///
/// The wait is on the compositor saying the keyboard reached a client rather
/// than on a clock: `Scene::focus_app` refuses a window with no surface, and a
/// silent no-op there would make every key below vanish for the fixture's reason
/// rather than the lock's. The compositor distinguishes the two out loud, and
/// `tests/input.rs` says so at length.
fn a_client_being_typed_at(
    compositor: &Compositor,
) -> (domicile_test_chrome::Chrome, crate::running::Client, String) {
    let mut chrome = compositor.chrome();
    let client = compositor.client("app");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes a focus");
    compositor.wait_for_log("keyboard focus -> client");

    (chrome, client, app_id)
}

/// A key forwarded at a locked desk reaches no client, and the passphrase
/// brings it back.
///
/// **BOTH HALVES IN ONE TEST, AND THE COUNT IS WHY.** A test can only prove
/// "the client was never given this" by waiting for an absence, which is a
/// sleep or a lie. So the *same key* is forwarded twice — once at a locked desk
/// and once at the desk the passphrase opened — and the client is required to
/// have been given exactly one of them. The socket is ordered, so a press the
/// lock had let through would have been traced before the one that follows the
/// unlock: seeing the second and counting one is exact rather than hopeful.
///
/// It is also the only arrangement that can fail for the right reason in both
/// directions. A lock that refused nothing traces two, and a lock nothing opens
/// traces none.
#[test]
fn a_locked_desk_refuses_the_keys_and_the_passphrase_starts_them_again() {
    let compositor = Compositor::started_with(A_DESK_THAT_CAN_LOCK);
    let (mut chrome, mut client, app_id) = a_client_being_typed_at(&compositor);

    lock_the_desk(&compositor, &mut chrome);

    press_a(&mut chrome, &app_id);
    compositor.wait_for_log("this desktop is locked");

    chrome
        .say(&ChromeMessage::Unlock {
            passphrase: Passphrase::from(THE_PASSPHRASE),
        })
        .expect("the chrome socket takes an unlock");
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: false }))
        .expect("the passphrase opens the desk and every chrome is told");

    press_a(&mut chrome, &app_id);
    assert!(
        client.wait_for_trace(A_PRESS_OF_IT, 1),
        "the desk was opened and the key still reached no client; it traced:\n{}",
        client.trace()
    );
    assert_eq!(
        client.trace().matches(A_PRESS_OF_IT).count(),
        1,
        "the key forwarded at the locked desk was delivered too; it traced:\n{}",
        client.trace()
    );
}

/// A page that connects over a locked desk is told the desk is locked.
///
/// **THE PROPERTY THE WHOLE DESIGN IS FOR.** A reload is a new page on a new
/// socket saying `hello`, which is what a second chrome here is — so this is
/// the test that a shell rebuilt, reloaded, or served by an engine that died
/// and came back does not come up drawing an open desktop over a desk that has
/// stopped listening. The edge that raised its lock screen went out before the
/// page existed.
#[test]
fn a_page_that_connects_over_a_locked_desk_is_told_so() {
    let compositor = Compositor::started_with(A_DESK_THAT_CAN_LOCK);
    let mut chrome = compositor.chrome();
    lock_the_desk(&compositor, &mut chrome);

    compositor
        .chrome()
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .expect("a page that has only just connected is told where the desk stands");
}

/// A passphrase the desk refuses leaves it shut, and does not turn up in the
/// log.
///
/// The second half is not decoration. The compositor says out loud that it
/// refused something — a lock that said nothing would be a desk somebody is
/// guessing at with no trace of it anywhere — and the obvious way to write that
/// line is with the thing it refused in it, which would put the guess, and
/// sooner or later the real passphrase, in the journal. Both spellings are
/// checked: the one that was typed, and the one that would have worked.
#[test]
fn a_passphrase_the_desk_refuses_leaves_it_shut_and_stays_out_of_the_log() {
    let compositor = Compositor::started_with(A_DESK_THAT_CAN_LOCK);
    let mut chrome = compositor.chrome();
    lock_the_desk(&compositor, &mut chrome);
    let wrong = "hunter2";

    chrome
        .say(&ChromeMessage::Unlock {
            passphrase: Passphrase::from(wrong),
        })
        .expect("the chrome socket takes an unlock");
    compositor.wait_for_log("a passphrase this desktop did not take");

    let said = compositor.complaint();
    assert!(
        !said.contains(wrong),
        "the refused passphrase is in the log:\n{said}"
    );
    assert!(
        !said.contains(THE_PASSPHRASE),
        "the desk's own passphrase is in the log:\n{said}"
    );

    // And the desk is still shut, asked the one way a test can ask without
    // waiting for an absence: a page connecting is told where the desk stands.
    compositor
        .chrome()
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .expect("a desk that refused a passphrase is still locked");
}

/// A key held down when the desk locks is let go of for the client.
///
/// **THE RELEASE IS THE ONE THING A LOCK CANNOT SIMPLY REFUSE.** Everything else
/// it drops is an event that never happened as far as a client is concerned; a
/// release is the end of one that did. The seat's keyboard state is one seat's
/// and outlives every page, so a press that is delivered and a release that is
/// not leaves that key down in it for good — and on a desk whose keymap puts
/// `Caps_Lock` on a key somebody might hold, xkb unlocks one only on the release
/// of the press that locked it. `tests/stuck_keys.rs` is the same failure
/// reached through a reload, and says at length what it costs.
///
/// A modifier is how this happens without contrivance: a browser repeats an
/// ordinary keydown, so holding `a` goes on stirring the desk, where a Shift
/// held while somebody reads the screen sends nothing at all for the whole
/// timeout.
///
/// So the desk lets go of what it is holding on the turn it shuts, and this is
/// the client's side of that: the press goes in, nothing releases it, and the
/// release the client is given comes from the lock.
#[test]
fn a_key_held_when_the_desk_locks_is_let_go_of_for_the_client() {
    let compositor = Compositor::started_with(A_DESK_THAT_CAN_LOCK);
    let (mut chrome, mut client, app_id) = a_client_being_typed_at(&compositor);

    // Down, and never let go of.
    say_a(&mut chrome, &app_id, true);
    assert!(
        client.wait_for_trace(A_PRESS_OF_IT, 1),
        "the client never received the press, so it is not holding the key this \
         test is about; it traced:\n{}",
        client.trace()
    );

    lock_the_desk(&compositor, &mut chrome);

    assert!(
        client.wait_for_trace(A_RELEASE_OF_IT, 1),
        "the desk locked with the key still down in the seat, and nothing will \
         ever send its release; it traced:\n{}",
        client.trace()
    );
}
