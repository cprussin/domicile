//! Whether this desk is locked, and what a locked desk refuses.
//!
//! One question — *may what the page just forwarded be done* — and the state
//! behind it. The effectful half is in `main.rs`, where the seat is;
//! everything here is a decision over values handed in, so a locked desk can be
//! tested on a machine with no screen and no client.
//!
//! **THE COMPOSITOR HOLDS THE LOCK, AND THAT IS THE WHOLE POINT.** Input does
//! not originate here: the page owns it and forwards it, and this process
//! injects it into a Wayland seat. So the one place a lock can actually refuse
//! anything is the injection — which is here, and not the socket and not the
//! page. A lock the page held would be a lock that a reload opened, and an
//! engine that died and came back would open it too. A lock the *socket* held
//! would take the shell's own keys with it, and a shell that cannot hear a
//! keystroke cannot take a passphrase.
//!
//! So the page keeps every key it has while the desk is shut. That reads like a
//! hole and is the opposite: the page is the thing forwarding, and what it
//! forwards is dropped at [`refused`] — no Wayland client sees a keystroke or a
//! click — while the shell goes on drawing a lock screen and collecting what is
//! typed into it. See `HostMessage::Locked`.
//!
//! **THE VERIFIER IS A SEAM AND THE ONE BEHIND IT TODAY IS NOT A SECRET.**
//! [`Verifier`] is the whole of what "is this the right passphrase" means here.
//! [`ConfiguredPassphrase`] is the implementation there is: the string
//! `[lock] passphrase` states, compared. That file is generated into a
//! world-readable store, so it locks this desk against somebody walking up to
//! it and against nobody who can read the disk. PAM is what goes behind the
//! seam next; it needs no engine release, and `ROADMAP.md` carries it.
//!
//! What locks the desk is the idle edge — see [`crate::idle`], which decides
//! when nobody is at it. There is no message a page can send to lock one yet;
//! that is in `ROADMAP.md` too.

use domicile_protocol::{HostMessage, Passphrase};

use crate::ClientRequest;

/// Whether a passphrase opens this desk.
///
/// **THE SEAM, NAMED SO THAT THE THING BEHIND IT CAN BE REPLACED WITHOUT
/// MOVING ANYTHING ELSE.** Everything about the lock except this trait's one
/// method is independent of how a passphrase is checked: the refusal at the
/// seat, the state a chrome is told, the edge it is told on. PAM goes here, and
/// so would a smartcard, a fingerprint or a second desk's say-so.
///
/// It takes the [`Passphrase`] newtype rather than a `&str` so that the value
/// arrives at the one place that compares it without having passed through a
/// type that prints itself.
pub trait Verifier {
    fn opens_the_desk(&self, passphrase: &Passphrase) -> bool;
}

/// The verifier there is today: the passphrase the config states.
///
/// See this module's own note for what this is and is not. It is a mechanism
/// that makes the rest of the lock real and testable, not a secret store.
pub struct ConfiguredPassphrase {
    passphrase: String,
}

impl ConfiguredPassphrase {
    /// The verifier for a desk that stated a passphrase, and `None` for one
    /// that did not.
    ///
    /// **`None` IS A DESK WITH NO LOCK, NOT A LOCK THAT NOTHING OPENS.** The
    /// second is what building this anyway and refusing everything would be,
    /// and it is a desk that shuts itself the first time nobody is at it and
    /// can then never be opened from anywhere — a reboot, or another tty. So a
    /// desk that states no passphrase never gets a [`Lock`] for anything to
    /// reach, which is also why it sends no `locked` message at all.
    pub fn stated(passphrase: Option<&str>) -> Option<ConfiguredPassphrase> {
        passphrase.map(|passphrase| ConfiguredPassphrase {
            passphrase: passphrase.to_string(),
        })
    }
}

impl Verifier for ConfiguredPassphrase {
    /// An ordinary comparison, and it is not a constant-time one.
    ///
    /// Said rather than left to be noticed: the timing of this leaks how much
    /// of the passphrase a guess got right, to an attacker who can time it. It
    /// is not worth hardening *here*, because the same passphrase is sitting in
    /// a world-readable file that the attacker can simply read — the timing
    /// channel is the long way round the front door. What closes both is the
    /// real verifier behind this seam.
    fn opens_the_desk(&self, passphrase: &Passphrase) -> bool {
        passphrase.as_str() == self.passphrase
    }
}

/// What a passphrase offered at this desk did.
///
/// Three answers rather than a boolean, because the compositor says something
/// different about each and none of them is the other two. None of them carries
/// what was typed: a refusal is a line in a log, and the redaction is the
/// type's rather than the log line's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unlocking {
    /// It was the passphrase. The desk is open now, and every chrome is told.
    Opened,
    /// It was not. The desk stays shut, and nothing is broadcast — a page told
    /// `locked: true` again would learn nothing, and a page told anything else
    /// would be wrong.
    Refused,
    /// The desk was not shut, so there was nothing to open. A page that sent
    /// one of these is ahead of, or behind, the state it was last told.
    NothingToOpen,
}

/// Whether this desk is locked, and what would open it.
///
/// Built only for a desktop that stated a passphrase — see
/// [`ConfiguredPassphrase::stated`] — so the compositor's `Option<Lock<_>>` is
/// the same shape, and for the same reason, as its `Option<Idle<_>>`.
pub struct Lock<V> {
    verifier: V,
    locked: bool,
}

impl<V: Verifier> Lock<V> {
    /// A desk this verifier opens, not locked yet: a desktop comes up open, and
    /// what shuts it is nobody being at it.
    pub fn held_by(verifier: V) -> Lock<V> {
        Lock {
            verifier,
            locked: false,
        }
    }

    pub fn locked(&self) -> bool {
        self.locked
    }

    /// Lock this desk. `true` only on the edge into a locked one.
    ///
    /// The edge because a desk nobody has opened blanks more than once: its
    /// screens go dark, a hand brings them back without opening anything, and
    /// the clock comes round again. A second `locked: true` on the wire would
    /// be a shell told to raise a lock screen it already has up, which is at
    /// best a repaint and at worst a passphrase half typed and thrown away.
    pub fn shut(&mut self) -> bool {
        let was_open = !self.locked;
        self.locked = true;
        was_open
    }

    /// Somebody typed a passphrase. Opens the desk if it is the right one.
    ///
    /// Written so that it cannot lock anything: the only state it can reach is
    /// open. A desk shuts because nobody is at it, and never because somebody
    /// said the wrong word at it — an offer that locked a desk it found open
    /// would be a lock a page could raise by guessing.
    pub fn offered(&mut self, passphrase: &Passphrase) -> Unlocking {
        if !self.locked {
            Unlocking::NothingToOpen
        } else if self.verifier.opens_the_desk(passphrase) {
            self.locked = false;
            Unlocking::Opened
        } else {
            Unlocking::Refused
        }
    }
}

/// Why a locked desk does not do what it was asked.
///
/// Two answers rather than a boolean, because the compositor says something
/// different about each. Neither carries what was asked for: a refused spawn's
/// command line is somebody's, and the line in the log is about the lock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// A hand, forwarded to a client. Dropped without a word worth a warning,
    /// because a hand at a locked desk is ordinary: it is how somebody wakes
    /// one to type a passphrase at it.
    Hand,
    /// Something the shell asked this compositor to do to the desktop on
    /// behalf of whoever is at it. Said out loud, because a shell that asks
    /// one of these of a locked desk has drawn a panel over its own lock screen.
    Command,
}

/// Whether this request is refused while the desk is locked, and why.
///
/// **THE REFUSAL, AND IT IS AT THE COMPOSITOR RATHER THAN IN THE SHELL.** Every
/// hand on this desktop arrives as one of these, because the page owns the
/// input and forwards it — the same property that makes [`crate::idle`]'s count
/// honest — and so does everything a shell can ask done to the desktop. A lock
/// that trusted the shell not to draw the panels that ask would be a lock the
/// shell held.
///
/// **EXHAUSTIVE, AND THAT IS THE MECHANISM.** No arm here is a wildcard, so a
/// request added later does not compile until somebody has decided whether a
/// locked desk answers it. A list that could go stale silently would be a hole
/// that opened the day it did.
///
/// **A POINTER LEAVING A WINDOW IS REFUSED, WHERE `somebody_is_here` DOES NOT
/// COUNT IT.** The two questions are not the same one. A leave is a real thing
/// done to a client — it is what tells the window under the pointer that the
/// pointer has gone — so delivering one while the desk is shut would let a page
/// move a client's idea of where the pointer is. That it is a poor signal about
/// whether a *person* is here has nothing to do with it.
///
/// **A WINDOW HANDED THE KEYBOARD IS NOT REFUSED, AND IT IS THE CLOSE CALL.**
/// The brain moves the focus before this is asked (`FocusApp` in
/// `read_chrome_messages`), and the seat follows it. Refusing the seat's half would
/// leave the two disagreeing after the unlock — the page drawing one window
/// active while every key went into another, which is the bug that ordering
/// exists to prevent — and it would buy nothing: no key reaches the window it
/// hands the keyboard to until the desk is open.
///
/// The rest are the desktop talking about itself, and refusing any of them
/// would be worse than useless. `ChromeHello` above all: a page that reloaded
/// while the desk was locked is told it is locked by *answering* that hello, so
/// a lock that swallowed it would be a locked desk with no lock screen on it.
/// `Unlock` is the way out and cannot be refused by the thing it is there to
/// open. A client's copy is a client's, not the shell's, and refusing it would
/// leave the history disagreeing with what a paste produces.
pub fn refused(request: &ClientRequest) -> Option<Refusal> {
    match request {
        ClientRequest::Key { .. }
        | ClientRequest::PointerMotion { .. }
        | ClientRequest::PointerLeave
        | ClientRequest::PointerButton { .. }
        | ClientRequest::PointerAxis { .. } => Some(Refusal::Hand),
        ClientRequest::CloseApp { .. }
        | ClientRequest::Spawn { .. }
        | ClientRequest::CopyClipboardEntry { .. } => Some(Refusal::Command),
        ClientRequest::KeyboardFocus { .. }
        | ClientRequest::SetOutputScale { .. }
        | ClientRequest::SetOutputSize { .. }
        | ClientRequest::ChromeHello { .. }
        | ClientRequest::ClipboardCopied { .. }
        | ClientRequest::Unlock { .. } => None,
    }
}

/// What a chrome is told about whether this desk is locked.
///
/// The state rather than the edge this compositor sends it on, for the reason
/// `crate::idle::announced` takes a state: a page reloads, and one that has
/// just loaded has missed every edge there ever was. Here that matters more
/// than it does there — the edge a reloaded page missed is the one that would
/// have raised its lock screen — and it is the property the whole design is
/// for, since the reload is exactly what must not open the desk.
///
/// See [`HostMessage::Locked`] for what a shell may and may not conclude from
/// it.
pub fn announced(locked: bool) -> HostMessage {
    HostMessage::Locked { locked }
}

#[cfg(test)]
mod tests {
    use domicile_protocol::{HostMessage, Passphrase};

    use super::{announced, refused, ConfiguredPassphrase, Lock, Refusal, Unlocking, Verifier};
    use crate::engine::Clipboard;
    use crate::ClientRequest;

    /// A verifier that takes one word, so the tests below are about the lock
    /// rather than about what a passphrase is.
    struct OnlyTheWord(&'static str);

    impl Verifier for OnlyTheWord {
        fn opens_the_desk(&self, passphrase: &Passphrase) -> bool {
            passphrase.as_str() == self.0
        }
    }

    /// A desk that opens to `"friend"` and is not locked yet.
    fn desk() -> Lock<OnlyTheWord> {
        Lock::held_by(OnlyTheWord("friend"))
    }

    #[test]
    fn a_desk_that_states_no_passphrase_has_no_lock_at_all() {
        // NOT A LOCK THAT NOTHING OPENS, which is the shape this would take if
        // the verifier were built anyway and refused everything: that desk
        // locks itself the first time nobody is at it and can then never be
        // opened, from the page or from anywhere else. So a desk with no
        // passphrase has no `Lock` for anything to reach.
        assert!(ConfiguredPassphrase::stated(None).is_none());
        assert!(ConfiguredPassphrase::stated(Some("open sesame")).is_some());
    }

    #[test]
    fn the_configured_passphrase_is_the_one_that_opens_the_desk() {
        let verifier =
            ConfiguredPassphrase::stated(Some("open sesame")).expect("a passphrase was stated");
        assert!(verifier.opens_the_desk(&Passphrase::from("open sesame")));
        assert!(!verifier.opens_the_desk(&Passphrase::from("open sesam")));
    }

    #[test]
    fn a_desk_shuts_once_and_says_so_once() {
        let mut lock = desk();
        assert!(!lock.locked());

        assert!(lock.shut(), "the turn a desk shuts on is an edge");
        assert!(lock.locked());

        // THE SECOND BLANK OF A DESK NOBODY HAS OPENED. Its screens go dark,
        // come back on a hand, go dark again -- and the lock has been up the
        // whole time. A second `locked: true` to every chrome would be a
        // shell's lock screen told to raise itself over one already up.
        assert!(!lock.shut());
        assert!(lock.locked());
    }

    #[test]
    fn the_passphrase_opens_the_desk_and_nothing_else_does() {
        let mut lock = desk();
        lock.shut();

        assert_eq!(
            lock.offered(&Passphrase::from("enemy")),
            Unlocking::Refused,
            "a desk that took the wrong passphrase would not be a lock"
        );
        assert!(lock.locked(), "and it stays shut");

        assert_eq!(lock.offered(&Passphrase::from("friend")), Unlocking::Opened);
        assert!(!lock.locked());
    }

    #[test]
    fn a_passphrase_offered_at_an_open_desk_opens_nothing() {
        // THREE ANSWERS RATHER THAN TWO, because the compositor says something
        // different about each: an `Opened` is broadcast, a `Refused` is a line
        // in the log, and this one is a page that sent an unlock at a desk that
        // was never shut -- which is neither, and must not be reported as a
        // desk that has just been opened.
        let mut lock = desk();
        assert_eq!(
            lock.offered(&Passphrase::from("friend")),
            Unlocking::NothingToOpen
        );
        assert!(!lock.locked());
    }

    #[test]
    fn what_a_locked_desk_refuses_is_every_hand() {
        for (what, request) in [
            (
                "a key",
                ClientRequest::Key {
                    keycode: 30,
                    pressed: true,
                },
            ),
            (
                "the pointer moving over a window",
                ClientRequest::PointerMotion {
                    app_id: "app-1".into(),
                    x: 4.0,
                    y: 8.0,
                },
            ),
            ("the pointer leaving a window", ClientRequest::PointerLeave),
            (
                "a click",
                ClientRequest::PointerButton {
                    button: 272,
                    pressed: true,
                },
            ),
            (
                "the wheel",
                ClientRequest::PointerAxis {
                    dx: 0.0,
                    dy: 1.0,
                    v120_x: 0,
                    v120_y: 120,
                },
            ),
        ] {
            assert_eq!(
                refused(&request),
                Some(Refusal::Hand),
                "{what} must not reach a client on a locked desk"
            );
        }
    }

    #[test]
    fn what_a_locked_desk_refuses_is_everything_the_shell_asks_done_to_it() {
        for (what, request) in [
            (
                "a window being closed",
                ClientRequest::CloseApp {
                    app_id: "app-1".into(),
                },
            ),
            (
                "a program being started",
                ClientRequest::Spawn {
                    command: vec!["foot".into()],
                },
            ),
            (
                "a row of the clipboard put back on the seat",
                ClientRequest::CopyClipboardEntry { entry: 1 },
            ),
        ] {
            assert_eq!(
                refused(&request),
                Some(Refusal::Command),
                "{what} is the desktop acting for whoever is at it, and a \
                 locked desk has nobody it acts for"
            );
        }
    }

    #[test]
    fn what_the_desktop_says_about_itself_is_not_refused() {
        for (what, request) in [
            (
                "the chrome handing a window the keyboard",
                ClientRequest::KeyboardFocus {
                    app_id: Some("app-1".into()),
                },
            ),
            (
                "the chrome reporting its density",
                ClientRequest::SetOutputScale {
                    ratio: 2.0,
                    scale: 2,
                },
            ),
            (
                "the chrome reporting its size",
                ClientRequest::SetOutputSize {
                    logical: (1920, 1080),
                },
            ),
            (
                "a page saying hello",
                ClientRequest::ChromeHello { served_by: None },
            ),
            (
                "a client putting something on the clipboard",
                ClientRequest::ClipboardCopied {
                    clipboard: Clipboard::Copy,
                    text: "what was copied".into(),
                },
            ),
            (
                "somebody typing the passphrase",
                ClientRequest::Unlock {
                    passphrase: Passphrase::from("friend"),
                },
            ),
        ] {
            assert_eq!(
                refused(&request),
                None,
                "{what} opens nothing, and refusing it would wedge a locked desk \
                 rather than protect it"
            );
        }
    }

    #[test]
    fn the_shell_is_told_where_the_desk_stands_rather_than_which_way_it_went() {
        // THE ONE WAY THIS CAN BE WRONG IS BACKWARD, and backward is a lock
        // screen that clears when the desk shuts. Both directions, because an
        // inversion reads perfectly well from either one alone.
        assert_eq!(announced(true), HostMessage::Locked { locked: true });
        assert_eq!(announced(false), HostMessage::Locked { locked: false });
    }
}
