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
//! **THE VERIFIER IS A SEAM, AND A DESK SAYS WHICH ONE IS BEHIND IT.**
//! [`Verifier`] is the whole of what "is this the right passphrase" means here,
//! and [`chosen`] reads which from the config: `[lock] pam_service` is PAM, as
//! the desk's own user — [`crate::pam`] — and `[lock] passphrase` is the string
//! that file states, compared. That file is generated into a world-readable
//! store, so the second locks this desk against somebody walking up to it and
//! against nobody who can read the disk. A desk states one or neither; neither
//! is a fallback for the other.
//!
//! **CHECKED OFF THE THREAD THAT ASKED.** PAM sleeps on a wrong password on
//! purpose, and the thread a passphrase arrives on is the compositor's loop. So
//! [`Lock::offered`] starts the check on a thread of its own, the desk stays
//! shut while it runs, and [`Lock::answered`] takes the verdict when the loop
//! hears it.
//!
//! What locks the desk is the idle edge — see [`crate::idle`], which decides
//! when nobody is at it. There is no message a page can send to lock one yet;
//! that is in `ROADMAP.md` too.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use domicile_config::LockVerifier;
use domicile_protocol::{HostMessage, Passphrase};

use crate::pam::{NoPam, Pam};
use crate::{ClientRequest, ConnectionRequest};

/// Whether a passphrase opens this desk.
///
/// **THE SEAM, NAMED SO THAT THE THING BEHIND IT CAN BE REPLACED WITHOUT
/// MOVING ANYTHING ELSE.** Everything about the lock except this trait's one
/// method is independent of how a passphrase is checked: the refusal at the
/// seat, the state a chrome is told, the edge it is told on. PAM is behind it
/// — [`crate::pam`] — and so could a smartcard, a fingerprint or a second
/// desk's say-so be.
///
/// **IT MAY BLOCK, AND IT IS NEVER CALLED WHERE THAT MATTERS.** PAM sleeps on
/// a wrong password on purpose, so [`Lock::offered`] runs this on a thread of
/// its own and the verdict comes back through the answer the lock was built
/// with. `Send + Sync` is what that thread takes.
///
/// It takes the [`Passphrase`] newtype rather than a `&str` so that the value
/// arrives at the one place that compares it without having passed through a
/// type that prints itself.
pub trait Verifier: Send + Sync {
    fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict;
}

/// What a verifier says about one passphrase: whether it opens the desk, or
/// why that could not be found out.
pub type Verdict = Result<bool, CouldNotCheck>;

/// A verifier that could not say either way.
///
/// **NOT A REFUSAL, AND THE DIFFERENCE IS THE POINT.** A wrong passphrase is a
/// person who mistyped; this is a desk that cannot be opened by anybody until
/// something about the machine changes — a module missing, a helper that will
/// not run. Both leave the desk shut, and only this one is an error in the log.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct CouldNotCheck(pub String);

/// The verifier a desk stated in its config, or `None` for a desk that stated
/// none.
///
/// **`None` IS A DESK WITH NO LOCK, NOT A LOCK THAT NOTHING OPENS.** The second
/// is what building a verifier anyway and refusing everything would be, and it
/// is a desk that shuts itself the first time nobody is at it and can then
/// never be opened from anywhere — a reboot, or another tty. So a desk that
/// states neither never gets a [`Lock`] for anything to reach, which is also
/// why it sends no `locked` message at all.
///
/// **AN `Err` IS A DESK THAT DOES NOT COME UP.** A desk that asked for PAM and
/// cannot have it gets neither of the other two answers: not no lock, which is
/// a desk that stopped locking without a word, and not the passphrase, which a
/// desk that states `pam_service` does not have. `pam_confdir` is where PAM's
/// service files are — [`crate::pam::SERVICES`] on a real desk.
pub fn chosen(
    stated: Option<LockVerifier<'_>>,
    pam_confdir: &Path,
) -> Result<Option<Box<dyn Verifier>>, NoPam> {
    match stated {
        None => Ok(None),
        Some(LockVerifier::Passphrase(passphrase)) => Ok(Some(Box::new(ConfiguredPassphrase {
            passphrase: passphrase.to_string(),
        }))),
        Some(LockVerifier::Pam { service }) => {
            Ok(Some(Box::new(Pam::for_this_user(service, pam_confdir)?)))
        }
    }
}

/// The verifier a desk gets from `lock.passphrase`: the string it states.
///
/// A mechanism rather than a secret — the file it comes from is generated into
/// a world-readable store. `lock.pam_service` is the one whose secret is not in
/// that file.
struct ConfiguredPassphrase {
    passphrase: String,
}

impl Verifier for ConfiguredPassphrase {
    /// An ordinary comparison, and it is not a constant-time one.
    ///
    /// Said rather than left to be noticed: the timing of this leaks how much
    /// of the passphrase a guess got right, to an attacker who can time it. It
    /// is not worth hardening *here*, because the same passphrase is sitting in
    /// a world-readable file that the attacker can simply read — the timing
    /// channel is the long way round the front door. A desk that wants neither
    /// uses PAM.
    fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict {
        Ok(passphrase.as_str() == self.passphrase)
    }
}

/// What offering a passphrase at this desk started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Offer {
    /// It is being checked, off this thread; [`Lock::answered`] is where the
    /// verdict lands.
    Checking,
    /// Another passphrase is being checked, so this one is not — it is dropped
    /// rather than queued. See [`Lock::offered`].
    StillChecking,
    /// The desk was not shut, so there was nothing to open. A page that sent
    /// one of these is ahead of, or behind, the state it was last told.
    NothingToOpen,
}

/// What a checked passphrase did.
///
/// Three answers rather than a boolean, because the compositor says something
/// different about each and none of them is the other two. None of them carries
/// what was typed: a refusal is a line in a log, and the redaction is the
/// type's rather than the log line's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unlocking {
    /// It was the passphrase. The desk is open now, and every chrome is told.
    Opened,
    /// It was not. The desk stays shut, and nothing is broadcast — a page told
    /// `locked: true` again would learn nothing, and a page told anything else
    /// would be wrong.
    Refused,
    /// The verifier could not say. The desk stays shut, and this is an error
    /// rather than a refusal — see [`CouldNotCheck`].
    Unverifiable(CouldNotCheck),
}

/// Where a desk that can lock stands.
#[derive(Debug)]
enum State {
    Open,
    Shut,
    /// Shut, with a passphrase out being checked.
    Checking,
}

impl State {
    /// Whether this is a locked desk, which a desk with a passphrase being
    /// checked is: nothing is let through until the verdict says so.
    fn locked(&self) -> bool {
        match self {
            State::Open => false,
            State::Shut | State::Checking => true,
        }
    }
}

/// Whether this desk is locked, and what would open it.
///
/// Built only for a desktop that stated a verifier — see [`chosen`] — so the
/// compositor's `Option<Lock>` is the same shape, and for the same reason, as
/// its `Option<Idle<_>>`.
///
/// **`state` IS SHARED, AND MOVED ONLY HERE.** Every [`Seen`] reads it, from
/// the chrome connections' threads; see there for what orders the two.
pub struct Lock {
    verifier: Arc<dyn Verifier>,
    answer: Arc<dyn Fn(Verdict) + Send + Sync>,
    state: Arc<Mutex<State>>,
}

impl Lock {
    /// A desk this verifier opens, not locked yet: a desktop comes up open, and
    /// what shuts it is nobody being at it.
    ///
    /// `answer` is where a verdict goes, from the thread that reached it. In
    /// the compositor that is a channel into its own loop, which hands the
    /// verdict back to [`Lock::answered`] on the thread the seat is on.
    pub fn held_by(
        verifier: Box<dyn Verifier>,
        answer: impl Fn(Verdict) + Send + Sync + 'static,
    ) -> Lock {
        Lock {
            verifier: Arc::from(verifier),
            answer: Arc::new(answer),
            state: Arc::new(Mutex::new(State::Open)),
        }
    }

    /// Whether this desk is locked. See [`State::locked`].
    pub fn locked(&self) -> bool {
        self.state.lock().unwrap().locked()
    }

    /// This lock's state, for a thread that is not the one holding it.
    pub fn seen(&self) -> Seen {
        Seen(Arc::clone(&self.state))
    }

    /// Lock this desk. `true` only on the edge into a locked one.
    ///
    /// The edge because a desk nobody has opened blanks more than once: its
    /// screens go dark, a hand brings them back without opening anything, and
    /// the clock comes round again. A second `locked: true` on the wire would
    /// be a shell told to raise a lock screen it already has up, which is at
    /// best a repaint and at worst a passphrase half typed and thrown away.
    ///
    /// A desk being checked stays being checked: it is already shut.
    pub fn shut(&mut self) -> bool {
        let mut state = self.state.lock().unwrap();
        match *state {
            State::Open => {
                *state = State::Shut;
                true
            }
            State::Shut | State::Checking => false,
        }
    }

    /// Somebody typed a passphrase. Starts checking it, if the desk is shut and
    /// nothing else is being checked.
    ///
    /// Written so that it cannot lock anything: the only state it can reach is
    /// one on the way to open. A desk shuts because nobody is at it, and never
    /// because somebody said the wrong word at it — an offer that locked a desk
    /// it found open would be a lock a page could raise by guessing.
    ///
    /// **ONE AT A TIME, AND THE SECOND IS DROPPED.** Two out at once would be
    /// two verdicts racing to decide one desk, and a page that sent a hundred
    /// would be a hundred threads each paying PAM's delay. Not queued either:
    /// the shell clears its field on every submit, so what was typed while the
    /// desk was busy is already gone from the screen.
    pub fn offered(&mut self, passphrase: &Passphrase) -> Offer {
        let mut state = self.state.lock().unwrap();
        match *state {
            State::Open => Offer::NothingToOpen,
            State::Checking => Offer::StillChecking,
            State::Shut => {
                *state = State::Checking;
                let verifier = Arc::clone(&self.verifier);
                let answer = Arc::clone(&self.answer);
                // A copy, moved into the check and dropped the moment it ends:
                // the one the page sent is dropped by the caller as this
                // returns, so neither outlives the verdict.
                let passphrase = passphrase.clone();
                thread::Builder::new()
                    .name("lock verifier".into())
                    .spawn(move || answer(verifier.opens_the_desk(&passphrase)))
                    .expect("a thread to check a passphrase on");
                Offer::Checking
            }
        }
    }

    /// The verdict on the passphrase [`Lock::offered`] started checking.
    ///
    /// Only reachable from a desk being checked: one check is out at a time and
    /// this is where it comes back, so a verdict for any other state is two
    /// checks where the lock allows one.
    pub fn answered(&mut self, verdict: Verdict) -> Unlocking {
        let mut state = self.state.lock().unwrap();
        match *state {
            State::Open | State::Shut => {
                unreachable!("a verdict arrives only for the one passphrase being checked")
            }
            State::Checking => match verdict {
                Ok(true) => {
                    *state = State::Open;
                    Unlocking::Opened
                }
                Ok(false) => {
                    *state = State::Shut;
                    Unlocking::Refused
                }
                Err(why) => {
                    *state = State::Shut;
                    Unlocking::Unverifiable(why)
                }
            },
        }
    }
}

/// Whether this desk is locked, read from a chrome connection's thread.
///
/// The [`Lock`] lives on the Wayland thread, and a few requests are answered
/// on a connection instead — see [`Asked`]. This is how those see it: the
/// lock's own state rather than a copy, so a desk with a passphrase being
/// checked is as shut here as it is there, and there is no second thing to
/// keep in step on every edge. Read-only, because nothing but the lock may
/// move it.
///
/// **THE MUTEX IS WHAT ORDERS THE EDGES.** The Wayland thread moves the state
/// before it queues the `locked` message that says so, in both directions. So
/// a search a page sends after it was told `locked: true` is read by a
/// connection that sees the desk shut, and one sent after `locked: false` by a
/// connection that sees it open. One sent after `unlock` and read before the
/// verdict is refused: it fails shut.
#[derive(Debug, Clone)]
pub struct Seen(Arc<Mutex<State>>);

impl Seen {
    pub fn locked(&self) -> bool {
        self.0.lock().unwrap().locked()
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
    /// Something the shell asked this compositor to do to the desktop, or to
    /// read out of the home, on behalf of whoever is at it. Said out loud,
    /// because a shell that asks one of these of a locked desk has drawn a
    /// panel over its own lock screen.
    Command,
}

/// Something a locked desk can be asked, named by where it is asked.
///
/// **TWO PLACES AND ONE LIST.** Most of what a chrome says crosses to the
/// Wayland thread as a [`ClientRequest`], because that is where the seat and
/// the windows are. A few things are answered on the chrome connection that
/// read them instead — a launcher's search, above all, which must not wait on
/// a frame — and a lock that could only see the first kind would be a lock a
/// launcher walked around. So both kinds come to [`refused`], and the list of
/// what a locked desk refuses stays one `match` wherever the asking is done.
#[derive(Clone, Copy)]
pub enum Asked<'a> {
    OnTheWaylandThread(&'a ClientRequest),
    OnTheConnection(&'a ConnectionRequest),
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
///
/// **A LAUNCHER'S SEARCH AND PREVIEW ARE REFUSED, WHERE THEY ARE ANSWERED.**
/// Both read the home for whoever is at the desk — a list of names, and the
/// front of a file — which is the desktop acting for somebody a locked desk
/// does not have. They are answered on the chrome connection, so they are
/// asked there, as [`Asked::OnTheConnection`]; the answer to a refused one is
/// no answer at all, whatever the query or path, so it says nothing about what
/// is on the disk.
///
/// **A THEME IS NOT REFUSED.** It opens nothing and reads nothing, and the
/// person at a locked desk is looking at it anyway. Refusing it would buy
/// nothing, and a shell that turns its desk over at sunset would leave its lock
/// screen in the day's colors all night.
pub fn refused(asked: Asked) -> Option<Refusal> {
    match asked {
        Asked::OnTheWaylandThread(
            ClientRequest::Key { .. }
            | ClientRequest::PointerMotion { .. }
            | ClientRequest::PointerLeave
            | ClientRequest::PointerButton { .. }
            | ClientRequest::PointerAxis { .. },
        ) => Some(Refusal::Hand),
        Asked::OnTheWaylandThread(
            ClientRequest::CloseApp { .. }
            | ClientRequest::Spawn { .. }
            | ClientRequest::CopyClipboardEntry { .. },
        )
        | Asked::OnTheConnection(
            ConnectionRequest::SearchFiles { .. } | ConnectionRequest::PreviewFile { .. },
        ) => Some(Refusal::Command),
        Asked::OnTheWaylandThread(
            ClientRequest::KeyboardFocus { .. }
            | ClientRequest::SetOutputScale { .. }
            | ClientRequest::SetOutputSize { .. }
            | ClientRequest::ChromeHello { .. }
            | ClientRequest::ClipboardCopied { .. }
            | ClientRequest::Unlock { .. },
        )
        | Asked::OnTheConnection(ConnectionRequest::SetTheme { .. }) => None,
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
    use domicile_protocol::{HostMessage, Passphrase, Theme};

    use std::path::Path;
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    use domicile_config::LockVerifier;

    use super::{
        announced, chosen, refused, Asked, CouldNotCheck, Lock, Offer, Refusal, Unlocking, Verdict,
        Verifier,
    };
    use crate::engine::Clipboard;
    use crate::{ClientRequest, ConnectionRequest};

    /// A verifier that takes one word, so the tests below are about the lock
    /// rather than about what a passphrase is.
    struct OnlyTheWord(&'static str);

    impl Verifier for OnlyTheWord {
        fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict {
            Ok(passphrase.as_str() == self.0)
        }
    }

    /// A desk that opens to `"friend"` and is not locked yet, and where its
    /// verdicts arrive.
    fn desk() -> (Lock, mpsc::Receiver<Verdict>) {
        held_by(OnlyTheWord("friend"))
    }

    /// A desk behind `verifier`, whose verdicts come back on a channel the way
    /// the compositor's come back on its loop.
    fn held_by(verifier: impl Verifier + 'static) -> (Lock, mpsc::Receiver<Verdict>) {
        let (told, heard) = mpsc::channel();
        let lock = Lock::held_by(Box::new(verifier), move |verdict| {
            told.send(verdict).expect("the test is listening")
        });
        (lock, heard)
    }

    /// Offer `passphrase` at a shut desk and hand it the verdict that comes back.
    fn offer(lock: &mut Lock, heard: &mpsc::Receiver<Verdict>, passphrase: &str) -> Unlocking {
        assert_eq!(lock.offered(&Passphrase::from(passphrase)), Offer::Checking);
        let verdict = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the verifier answers");
        lock.answered(verdict)
    }

    #[test]
    fn a_desk_that_states_no_verifier_has_no_lock_at_all() {
        // NOT A LOCK THAT NOTHING OPENS, which is the shape this would take if
        // a verifier were built anyway and refused everything: that desk locks
        // itself the first time nobody is at it and can then never be opened,
        // from the page or from anywhere else. So a desk that states neither
        // verifier has no `Lock` for anything to reach.
        assert!(chosen(None, Path::new("/nonexistent"))
            .expect("nothing stated is nothing to fail")
            .is_none());
    }

    #[test]
    fn the_configured_passphrase_is_the_one_that_opens_the_desk() {
        let verifier = chosen(
            Some(LockVerifier::Passphrase("open sesame")),
            Path::new("/nonexistent"),
        )
        .expect("a passphrase needs nothing from the machine")
        .expect("a passphrase was stated");
        assert!(verifier
            .opens_the_desk(&Passphrase::from("open sesame"))
            .unwrap());
        assert!(!verifier
            .opens_the_desk(&Passphrase::from("open sesam"))
            .unwrap());
    }

    #[test]
    fn a_desk_that_asked_for_a_pam_service_the_machine_lacks_does_not_come_up() {
        // NOT A DESK WITH NO LOCK, AND NOT ONE BEHIND PAM'S `other`. Linux-PAM
        // answers a service it has no file for with the `other` stack, which on
        // one distribution denies everything -- a desk nothing opens -- and on
        // another is the ordinary login stack. Neither is what was asked for,
        // and a desk that came up without its lock would be worse. So the
        // answer is no desk, and a sentence that says what to declare.
        let confdir = tempfile::tempdir().expect("a directory");
        let Err(why) = chosen(
            Some(LockVerifier::Pam {
                service: "domicile",
            }),
            confdir.path(),
        ) else {
            panic!("a PAM service with no file behind it is refused");
        };
        let said = why.to_string();
        assert!(
            said.contains(&confdir.path().join("domicile").display().to_string()),
            "it names the file it looked for: {said}"
        );
        assert!(
            said.contains("security.pam.services.domicile = {};"),
            "and what a NixOS machine has to declare: {said}"
        );
    }

    #[test]
    fn a_passphrase_is_checked_off_the_thread_that_offered_it() {
        // THE THREAD THAT OFFERS IS THE COMPOSITOR'S LOOP, and PAM blocks --
        // `pam_unix` sleeps a couple of seconds on a wrong password on
        // purpose. A check on the loop is every client's frame held for as
        // long as somebody's typo is being punished. So the verifier here does
        // not answer until the test says so, and the offer has to come back
        // before it does.
        struct UntilReleased(Mutex<mpsc::Receiver<()>>);
        impl Verifier for UntilReleased {
            fn opens_the_desk(&self, _: &Passphrase) -> Verdict {
                self.0
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(2))
                    .map(|()| true)
                    .map_err(|_| CouldNotCheck("nobody released it".into()))
            }
        }
        let (release, released) = mpsc::channel();
        let (mut lock, heard) = held_by(UntilReleased(Mutex::new(released)));
        lock.shut();

        assert_eq!(lock.offered(&Passphrase::from("friend")), Offer::Checking);
        release
            .send(())
            .expect("the verifier is still waiting, so the offer did not wait for it");
        let verdict = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the verifier answers");
        assert_eq!(lock.answered(verdict), Unlocking::Opened);
    }

    #[test]
    fn a_desk_being_checked_is_shut_and_takes_no_second_passphrase() {
        // ONE CHECK AT A TIME. A second passphrase while the first is out would
        // be two verdicts racing to decide one desk, and a page that sent a
        // hundred would be a hundred threads each costing PAM's delay. It is
        // not queued either: the shell clears its field on every submit, so
        // what was typed while the desk was busy is gone from the screen and
        // should be gone from here.
        let (mut lock, heard) = desk();
        lock.shut();

        assert_eq!(lock.offered(&Passphrase::from("friend")), Offer::Checking);
        assert!(lock.locked(), "a desk being checked is still shut");
        assert!(!lock.shut(), "and shutting it again is no edge");
        assert_eq!(
            lock.offered(&Passphrase::from("friend")),
            Offer::StillChecking
        );

        let verdict = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the first passphrase is answered");
        assert_eq!(lock.answered(verdict), Unlocking::Opened);
        assert!(
            heard.recv_timeout(Duration::from_millis(100)).is_err(),
            "and the second was never checked"
        );
    }

    #[test]
    fn a_verifier_that_cannot_check_leaves_the_desk_shut_and_says_why() {
        // FAIL CLOSED, AND OUT LOUD. PAM with a module missing, a helper it
        // cannot run, a user it cannot find: none of those is a wrong
        // passphrase, and reporting one as a refusal would hide a desk that
        // cannot be opened at all behind a person who thinks they mistyped.
        struct Broken;
        impl Verifier for Broken {
            fn opens_the_desk(&self, _: &Passphrase) -> Verdict {
                Err(CouldNotCheck("the module is not there".into()))
            }
        }
        let (mut lock, heard) = held_by(Broken);
        lock.shut();

        assert_eq!(
            offer(&mut lock, &heard, "friend"),
            Unlocking::Unverifiable(CouldNotCheck("the module is not there".into()))
        );
        assert!(lock.locked());
    }

    #[test]
    fn a_desk_shuts_once_and_says_so_once() {
        let (mut lock, _) = desk();
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
        let (mut lock, heard) = desk();
        lock.shut();

        assert_eq!(
            offer(&mut lock, &heard, "enemy"),
            Unlocking::Refused,
            "a desk that took the wrong passphrase would not be a lock"
        );
        assert!(lock.locked(), "and it stays shut");

        assert_eq!(offer(&mut lock, &heard, "friend"), Unlocking::Opened);
        assert!(!lock.locked());
    }

    #[test]
    fn a_chrome_connection_sees_the_desk_shut_and_open_as_the_lock_does() {
        // THE LOCK'S OWN STATE AND NOT A COPY OF IT. A copy is a second thing
        // to keep in step on every edge, and the edge somebody forgets is a
        // launcher answered at a locked desk -- the likeliest being the one a
        // passphrase is out being checked on, which PAM holds open for seconds
        // on a wrong password.
        let (mut lock, heard) = desk();
        let seen = lock.seen();
        assert!(!seen.locked());

        lock.shut();
        assert!(seen.locked(), "a desk that shut is shut from a connection");

        assert_eq!(lock.offered(&Passphrase::from("friend")), Offer::Checking);
        assert!(
            seen.locked(),
            "a desk with a passphrase being checked is shut from a connection too"
        );

        let verdict = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the verifier answers");
        assert_eq!(lock.answered(verdict), Unlocking::Opened);
        assert!(!seen.locked(), "and the verdict opens it there too");
    }

    #[test]
    fn a_passphrase_offered_at_an_open_desk_opens_nothing() {
        // NOT CHECKED AT ALL, and not reported as a desk that has just been
        // opened: this is a page that sent an unlock at a desk that was never
        // shut, which the compositor says something different about.
        let (mut lock, heard) = desk();
        assert_eq!(
            lock.offered(&Passphrase::from("friend")),
            Offer::NothingToOpen
        );
        assert!(!lock.locked());
        assert!(
            heard.recv_timeout(Duration::from_millis(100)).is_err(),
            "and nothing was asked of the verifier"
        );
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
                refused(Asked::OnTheWaylandThread(&request)),
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
                refused(Asked::OnTheWaylandThread(&request)),
                Some(Refusal::Command),
                "{what} is the desktop acting for whoever is at it, and a \
                 locked desk has nobody it acts for"
            );
        }
    }

    #[test]
    fn what_a_locked_desk_refuses_is_reading_the_home_for_a_launcher() {
        for (what, request) in [
            (
                "a search of the home",
                ConnectionRequest::SearchFiles {
                    query: "plan".into(),
                },
            ),
            (
                "a preview of a file in it",
                ConnectionRequest::PreviewFile {
                    path: "plan.org".into(),
                },
            ),
        ] {
            assert_eq!(
                refused(Asked::OnTheConnection(&request)),
                Some(Refusal::Command),
                "{what} reads somebody's files for whoever is at the desk, and \
                 a locked desk has nobody it reads for"
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
                refused(Asked::OnTheWaylandThread(&request)),
                None,
                "{what} opens nothing, and refusing it would wedge a locked desk \
                 rather than protect it"
            );
        }
        // Answered on the connection rather than on the Wayland thread, and
        // asked of the same list.
        assert_eq!(
            refused(Asked::OnTheConnection(&ConnectionRequest::SetTheme {
                theme: Theme::Dark,
            })),
            None
        );
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
