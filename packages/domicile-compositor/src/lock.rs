//! The screen lock's state and the list of requests it refuses.
//!
//! Everything here decides over values passed in; `main.rs` applies the
//! decisions to the seat. That keeps the lock testable without a screen or a
//! client.
//!
//! The compositor enforces the lock because it injects all input into the
//! Wayland seat. A lock held by the page would open on a reload or an engine
//! restart. The page keeps receiving keys while locked so the shell can draw a
//! lock screen and read the passphrase; [`refused`] drops what it forwards to
//! clients.
//!
//! The idle timeout ([`crate::idle`]) or `ChromeMessage::Lock` locks the
//! desktop. See `docs/LOCK.md`.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use domicile_config::LockVerifier;
use domicile_host::system::Reach;
use domicile_protocol::{HostMessage, Passphrase};

use crate::pam::{NoPam, Pam};
use crate::{ClientRequest, ConnectionRequest};

/// Checks whether a passphrase unlocks the desktop.
///
/// May block (PAM delays on a wrong password), so [`Lock::offered`] calls it on
/// its own thread. It takes a [`Passphrase`] rather than a `&str` so the value
/// never passes through a type that prints itself.
pub trait Verifier: Send + Sync {
    fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict;
}

/// A verifier's answer: whether the passphrase matches, or why it could not
/// check.
pub type Verdict = Result<bool, CouldNotCheck>;

/// A verifier that could not check the passphrase.
///
/// Distinct from a wrong passphrase: the machine is broken (a PAM module is
/// missing, a helper will not run), so nobody can unlock. Both keep the desktop
/// locked; only this one logs an error.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct CouldNotCheck(pub String);

/// Builds the verifier the config names, or `None` when it names none.
///
/// `None` means no lock at all. A lock that refused everything would lock
/// itself on idle and never open again.
///
/// Returns `Err` when the config asks for PAM and the service file is missing
/// in `pam_confdir` ([`crate::pam::SERVICES`] in production). The compositor
/// then fails to start rather than run without its lock.
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

/// The verifier for `lock.passphrase`: a plain string comparison.
///
/// The passphrase sits in a world-readable store, so this only stops someone at
/// the keyboard. `lock.pam_service` keeps the secret out of the config.
struct ConfiguredPassphrase {
    passphrase: String,
}

impl Verifier for ConfiguredPassphrase {
    /// Not constant-time. A timing attack is pointless when the passphrase is
    /// in a world-readable file.
    fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict {
        Ok(passphrase.as_str() == self.passphrase)
    }
}

/// What offering a passphrase started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Offer {
    /// The check is running on another thread; [`Lock::answered`] takes the
    /// verdict.
    Checking,
    /// Another check is running, so this passphrase is dropped, not queued.
    /// See [`Lock::offered`].
    StillChecking,
    /// The desktop is not locked. The page's state is out of date.
    NothingToOpen,
}

/// The outcome of a checked passphrase.
///
/// None of the variants carries the passphrase, so logging one cannot leak it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unlocking {
    /// Correct. The desktop unlocks and every chrome is told.
    Opened,
    /// Wrong. The desktop stays locked and every chrome is sent
    /// `locked: true` again, which the waiting page reads as the answer.
    Refused,
    /// The verifier could not check. Handled like [`Unlocking::Refused`], but
    /// logged as an error. See [`CouldNotCheck`].
    Unverifiable(CouldNotCheck),
}

/// The lock's state.
#[derive(Debug)]
enum State {
    Open,
    Shut,
    /// Locked, with a passphrase being checked.
    Checking,
}

impl State {
    /// Whether input is refused. A pending check counts as locked.
    fn locked(&self) -> bool {
        match self {
            State::Open => false,
            State::Shut | State::Checking => true,
        }
    }
}

/// The screen lock and the verifier that opens it.
///
/// Exists only when the config names a verifier (see [`chosen`]).
///
/// `state` is shared with every [`Seen`]; only `Lock` changes it.
pub struct Lock {
    verifier: Arc<dyn Verifier>,
    answer: Arc<dyn Fn(Verdict) + Send + Sync>,
    state: Arc<Mutex<State>>,
}

impl Lock {
    /// Creates an unlocked lock.
    ///
    /// `answer` receives each verdict on the verifier's thread. The compositor
    /// sends it to its event loop, which passes it to [`Lock::answered`].
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

    /// Whether the desktop is locked. See [`State::locked`].
    pub fn locked(&self) -> bool {
        self.state.lock().unwrap().locked()
    }

    /// A read-only view of the state for another thread.
    pub fn seen(&self) -> Seen {
        Seen(Arc::clone(&self.state))
    }

    /// Locks the desktop. Returns `true` only when it was unlocked.
    ///
    /// Blanking can repeat while locked. Sending `locked: true` again would
    /// make the shell redraw its lock screen and could discard a half-typed
    /// passphrase.
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

    /// Starts checking a passphrase if locked and no check is running.
    ///
    /// Never locks: an offer at an unlocked desktop does nothing, so a page
    /// cannot lock by sending a guess.
    ///
    /// A second offer during a check is dropped. Parallel checks would race,
    /// and each would pay PAM's delay. The shell keeps its input as sent until
    /// the verdict, so there is nothing to queue.
    pub fn offered(&mut self, passphrase: &Passphrase) -> Offer {
        let mut state = self.state.lock().unwrap();
        match *state {
            State::Open => Offer::NothingToOpen,
            State::Checking => Offer::StillChecking,
            State::Shut => {
                *state = State::Checking;
                let verifier = Arc::clone(&self.verifier);
                let answer = Arc::clone(&self.answer);
                // Moved into the check and dropped when it ends, so no copy
                // outlives the verdict.
                let passphrase = passphrase.clone();
                thread::Builder::new()
                    .name("lock verifier".into())
                    .spawn(move || answer(verifier.opens_the_desk(&passphrase)))
                    .expect("a thread to check a passphrase on");
                Offer::Checking
            }
        }
    }

    /// Applies the verdict for the passphrase [`Lock::offered`] is checking.
    ///
    /// Only one check runs at a time, so a verdict in any other state is a bug.
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

/// A read-only view of the lock state for chrome connection threads.
///
/// Some requests are answered on the connection instead of the Wayland thread
/// (see [`Asked`]). Sharing the lock's state, not a copy, keeps the two in
/// step, including while a check is running.
///
/// Ordering: the Wayland thread updates the state before it queues the
/// `locked` message. A request sent after the page saw `locked: true` is
/// refused, and one sent after `locked: false` is allowed. A request sent
/// during a check is refused.
#[derive(Debug, Clone)]
pub struct Seen(Arc<Mutex<State>>);

impl Seen {
    pub fn locked(&self) -> bool {
        self.0.lock().unwrap().locked()
    }
}

/// Why a request was refused while locked.
///
/// Neither variant carries the request, since a spawn's command line may be
/// private.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Input forwarded to a client. Not worth a warning: input is how someone
    /// wakes the screen to type a passphrase.
    Hand,
    /// A command the shell sent on the user's behalf. Logged as a warning,
    /// since a shell sending one while locked has a panel over its lock screen.
    Command,
}

/// A request the lock checks, by the thread that handles it.
///
/// Most requests go to the Wayland thread as a [`ClientRequest`]. A few, like
/// launcher searches, are answered on the chrome connection so they don't wait
/// on a frame. Both kinds go through [`refused`], so one `match` lists
/// everything the lock refuses.
#[derive(Clone, Copy)]
pub enum Asked<'a> {
    OnTheWaylandThread(&'a ClientRequest),
    OnTheConnection(&'a ConnectionRequest),
    /// A system call from the shell, by what it touches. See
    /// `docs/architecture/SYSTEM-ACCESS.md`.
    System(Reach),
}

/// Whether a request is refused while locked, and why.
///
/// The `match` has no wildcard arm, so a new request does not compile until
/// someone decides how the lock treats it.
///
/// Non-obvious cases:
///
/// - **`PointerLeave`** is refused. It changes what a client thinks the
///   pointer is over, even though `somebody_is_here` ignores it.
/// - **`KeyboardFocus`** is allowed. The page moves focus before this check
///   (`FocusApp` in `read_chrome_messages`) and the seat follows. Refusing it
///   would leave them out of step after unlock, and no key reaches the window
///   while locked anyway.
/// - **`ChromeHello`** is allowed. Answering it is how a reloaded page learns
///   it is locked.
/// - **`ClipboardCopied`** is allowed. It reports a client's copy; refusing it
///   would make the history disagree with what a paste produces.
/// - **Launcher searches and previews** are refused on the connection (see
///   [`Asked::OnTheConnection`]) with no answer, so they reveal nothing about
///   the disk.
/// - **Theme changes** are allowed. They open and read nothing, and keep the
///   lock screen's colors current.
/// - **System calls** are refused, except reads under `/sys`, so a lock screen
///   can show the battery, and calls that stop what the shell already started.
///   Processes and watches started before the lock keep running.
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
            | ClientRequest::CopyClipboardEntry { .. }
            | ClientRequest::ActivateTrayItem { .. }
            | ClientRequest::DismissNotifications { .. }
            | ClientRequest::InvokeNotificationAction { .. }
            // Changes what the user's applications play and record.
            | ClientRequest::Audio { .. }
            | ClientRequest::WatchAudioLevels { .. },
        )
        | Asked::OnTheConnection(
            ConnectionRequest::SearchFiles { .. }
            | ConnectionRequest::PreviewFile { .. }
            | ConnectionRequest::SearchApps { .. },
        )
        | Asked::System(Reach::Acts) => Some(Refusal::Command),
        Asked::OnTheWaylandThread(
            ClientRequest::KeyboardFocus { .. }
            | ClientRequest::SetOutputScale { .. }
            | ClientRequest::SetOutputSize { .. }
            | ClientRequest::SetAppBounds { .. }
            | ClientRequest::ChromeHello { .. }
            | ClientRequest::ClipboardCopied { .. }
            | ClientRequest::Unlock { .. }
            | ClientRequest::Lock
            // Changes nothing a client sees, and the lock screen needs light.
            | ClientRequest::SetBrightness { .. }
            // Part of a theme change; allowed like `SetTheme`.
            | ClientRequest::TurnTheWindows { .. }
            | ClientRequest::ThemeCaptured { .. },
        )
        | Asked::OnTheConnection(ConnectionRequest::SetTheme { .. })
        | Asked::System(Reach::ReadsTheKernel | Reach::Stops) => None,
    }
}

/// The `locked` message sent to a chrome.
///
/// Carries the state, not the transition, like `crate::idle::announced`. A
/// reloaded page has missed every transition and must still raise its lock
/// screen. See [`HostMessage::Locked`] for what a shell may conclude from it.
pub fn announced(locked: bool) -> HostMessage {
    HostMessage::Locked { locked }
}

#[cfg(test)]
mod tests {
    use domicile_protocol::{HostMessage, Passphrase, Theme, TrayAction};

    use std::path::Path;
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    use domicile_config::LockVerifier;
    use domicile_host::system::Reach;

    use super::{
        announced, chosen, refused, Asked, CouldNotCheck, Lock, Offer, Refusal, Unlocking, Verdict,
        Verifier,
    };
    use crate::engine::Clipboard;
    use crate::{ClientRequest, ConnectionRequest};

    /// A verifier that accepts one word, so the tests focus on the lock.
    struct OnlyTheWord(&'static str);

    impl Verifier for OnlyTheWord {
        fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict {
            Ok(passphrase.as_str() == self.0)
        }
    }

    /// An unlocked lock that opens to `"friend"`, and its verdict channel.
    fn desk() -> (Lock, mpsc::Receiver<Verdict>) {
        held_by(OnlyTheWord("friend"))
    }

    /// A lock behind `verifier`, with verdicts sent to a channel as in the
    /// compositor.
    fn held_by(verifier: impl Verifier + 'static) -> (Lock, mpsc::Receiver<Verdict>) {
        let (told, heard) = mpsc::channel();
        let lock = Lock::held_by(Box::new(verifier), move |verdict| {
            told.send(verdict).expect("the test is listening")
        });
        (lock, heard)
    }

    /// Offers `passphrase` while locked and applies the verdict.
    fn offer(lock: &mut Lock, heard: &mpsc::Receiver<Verdict>, passphrase: &str) -> Unlocking {
        assert_eq!(lock.offered(&Passphrase::from(passphrase)), Offer::Checking);
        let verdict = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the verifier answers");
        lock.answered(verdict)
    }

    #[test]
    fn a_desk_that_states_no_verifier_has_no_lock_at_all() {
        // A lock that refused everything would lock on idle and never open.
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
        // Linux-PAM falls back to the `other` stack for a missing service,
        // which denies everything on some distributions and allows a normal
        // login on others. Neither is what the config asked for, so fail with
        // a message that says what to declare.
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
        // Offers arrive on the compositor's loop, and `pam_unix` sleeps for
        // seconds on a wrong password. A check on the loop would stall every
        // client's frames. The verifier here blocks until released, so the
        // offer must return first.
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
        // Parallel checks would race, and each would pay PAM's delay.
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
        // Fail closed, and report it as an error rather than a wrong
        // passphrase, so a broken PAM setup is not mistaken for a typo.
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

        // Blanking repeats while locked. A second `locked: true` would make the
        // shell redraw its lock screen.
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
        // A copy would need syncing on every transition. Missing one would let
        // a launcher answer while locked, most likely during a check that PAM
        // holds open for seconds.
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
        // Not checked and not reported as an unlock: the page's state is out of
        // date.
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
            (
                "a tray icon clicked",
                ClientRequest::ActivateTrayItem {
                    id: ":1.9/StatusNotifierItem".into(),
                    action: TrayAction::Primary,
                },
            ),
            (
                "notifications cleared",
                ClientRequest::DismissNotifications { ids: vec![7] },
            ),
            (
                "a notification's action taken",
                ClientRequest::InvokeNotificationAction {
                    id: 7,
                    action: "default".into(),
                },
            ),
            (
                "a microphone metered",
                ClientRequest::WatchAudioLevels {
                    chrome: 1,
                    ids: vec!["input:mic".into()],
                },
            ),
            (
                "a stream turned down",
                ClientRequest::Audio {
                    request: domicile_host::audio::Request::Volume {
                        id: "playback:42".into(),
                        volume: 0.5,
                    },
                },
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
            (
                "a search of the applications installed",
                ConnectionRequest::SearchApps {
                    query: "fire".into(),
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

    /// The lock screen may still read the battery under `/sys`, and stop what
    /// the shell started. See `domicile_host::system::reach`.
    #[test]
    fn a_locked_desk_lets_the_shell_read_the_kernel_and_stop_things() {
        assert_eq!(refused(Asked::System(Reach::ReadsTheKernel)), None);
        assert_eq!(refused(Asked::System(Reach::Stops)), None);
        assert_eq!(
            refused(Asked::System(Reach::Acts)),
            Some(Refusal::Command),
            "a file read, a write or a process is the desktop acting for \
             whoever is at it"
        );
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
                "the page reporting where a window is",
                ClientRequest::SetAppBounds {
                    app_id: "app-1".into(),
                    bounds: domicile_scene::Bounds {
                        min: domicile_scene::Point::new(0.0, 0.0),
                        max: domicile_scene::Point::new(800.0, 600.0),
                    },
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
                "a theme turning the desk's windows",
                ClientRequest::TurnTheWindows {
                    theme: Theme::Dark,
                    chromes: vec![1],
                },
            ),
            (
                "a shell holding its old frame for a theme",
                ClientRequest::ThemeCaptured {
                    chrome: 1,
                    theme: Theme::Dark,
                },
            ),
            (
                "somebody typing the passphrase",
                ClientRequest::Unlock {
                    passphrase: Passphrase::from("friend"),
                },
            ),
            (
                "the shell locking a desk already locked",
                ClientRequest::Lock,
            ),
        ] {
            assert_eq!(
                refused(Asked::OnTheWaylandThread(&request)),
                None,
                "{what} opens nothing, and refusing it would wedge a locked desk \
                 rather than protect it"
            );
        }
        // Answered on the connection, but checked by the same `match`.
        assert_eq!(
            refused(Asked::OnTheConnection(&ConnectionRequest::SetTheme {
                theme: Theme::Dark,
            })),
            None
        );
    }

    #[test]
    fn the_shell_is_told_where_the_desk_stands_rather_than_which_way_it_went() {
        // An inversion would clear the lock screen on lock. Test both values,
        // since either alone would pass an inverted mapping.
        assert_eq!(announced(true), HostMessage::Locked { locked: true });
        assert_eq!(announced(false), HostMessage::Locked { locked: false });
    }
}
