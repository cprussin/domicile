//! The desktop locks before the machine sleeps, and when logind asks.
//!
//! A private `dbus-daemon` stands in for the system bus and the test for
//! logind. The fake hands out each inhibitor as one end of a socket pair, so
//! the test sees the compositor release it as the other end reading EOF.

mod running;

use std::io::{ErrorKind, Read};
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::Duration;

use domicile_protocol::HostMessage;
use zbus::blocking::Connection;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedFd, OwnedObjectPath};

use crate::running::bus::Bus;
use crate::running::Compositor;

const A_DESK: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

const LOGIND: &str = "org.freedesktop.login1";
const MANAGER: &str = "/org/freedesktop/login1";
const SESSION: &str = "/org/freedesktop/login1/session/_31";
const PATIENCE: Duration = Duration::from_secs(20);

#[test]
fn the_desk_locks_before_the_machine_sleeps_and_holds_off_the_next_sleep_on_waking() {
    let bus = Bus::started();
    let logind = Logind::serving(&bus);
    let compositor = Compositor::started_on_a_system_bus(A_DESK, &bus.address);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: false }))
        .expect("a page that says hello hears the desk is open");
    let mut first = logind.inhibitor(&compositor);
    assert_eq!(
        (first.what.as_str(), first.mode.as_str()),
        ("sleep", "delay"),
        "the compositor delays sleep rather than blocking it"
    );

    logind.prepare_for_sleep(true);
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .unwrap_or_else(|why| {
            panic!(
                "the desk did not lock before sleep: {why}\nthe compositor said:\n{}",
                compositor.complaint()
            )
        });
    assert!(
        first.held(),
        "the compositor let sleep go ahead before the lock screen had time to draw"
    );

    // Woken before the lock screen's wait ends, as after a failed sleep.
    logind.prepare_for_sleep(false);
    let mut second = logind.inhibitor(&compositor);
    first.released(&compositor);
    // Past the wait, which must close only the inhibitor it was for.
    std::thread::sleep(Duration::from_secs(2));
    assert!(
        second.held(),
        "the compositor released the inhibitor for the next sleep too, so that sleep will not \
         wait for the lock"
    );
}

#[test]
fn the_desk_locks_when_logind_locks_the_session() {
    let bus = Bus::started();
    let logind = Logind::serving(&bus);
    let compositor = Compositor::started_on_a_system_bus(A_DESK, &bus.address);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: false }))
        .expect("a page that says hello hears the desk is open");
    // Taken after the compositor listens for `Lock`.
    logind.inhibitor(&compositor);

    logind.lock_the_session();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .unwrap_or_else(|why| {
            panic!(
                "the desk did not lock when logind asked: {why}\nthe compositor said:\n{}",
                compositor.complaint()
            )
        });
}

/// The test's logind, serving a manager and one session.
struct Logind {
    connection: Connection,
    inhibitors: Receiver<Inhibitor>,
}

impl Logind {
    fn serving(bus: &Bus) -> Logind {
        let (taken, inhibitors) = channel();
        let connection = zbus::blocking::connection::Builder::address(bus.address.as_str())
            .expect("an address")
            .name(LOGIND)
            .expect("logind's name")
            .serve_at(MANAGER, Manager { taken })
            .expect("the manager is served")
            .serve_at(SESSION, Session)
            .expect("the session is served")
            .build()
            .expect("logind is on the bus");
        Logind {
            connection,
            inhibitors,
        }
    }

    /// The next inhibitor the compositor takes.
    fn inhibitor(&self, compositor: &Compositor) -> Inhibitor {
        self.inhibitors
            .recv_timeout(PATIENCE)
            .unwrap_or_else(|why| {
                panic!(
                    "the compositor took no inhibitor: {why}\nit said:\n{}",
                    compositor.complaint()
                )
            })
    }

    fn prepare_for_sleep(&self, start: bool) {
        let emitter = SignalEmitter::new(self.connection.inner(), MANAGER).expect("a path");
        zbus::block_on(Manager::prepare_for_sleep(&emitter, start)).expect("the signal is sent");
    }

    fn lock_the_session(&self) {
        let emitter = SignalEmitter::new(self.connection.inner(), SESSION).expect("a path");
        zbus::block_on(Session::lock(&emitter)).expect("the signal is sent");
    }
}

/// An inhibitor the compositor took: the end logind keeps.
struct Inhibitor {
    what: String,
    mode: String,
    kept: UnixStream,
}

impl Inhibitor {
    /// Whether the compositor still holds its end.
    fn held(&mut self) -> bool {
        self.kept.set_nonblocking(true).expect("a socket");
        let held = matches!(
            self.kept.read(&mut [0; 1]),
            Err(why) if why.kind() == ErrorKind::WouldBlock
        );
        self.kept.set_nonblocking(false).expect("a socket");
        held
    }

    /// Wait for the compositor to close its end.
    fn released(&mut self, compositor: &Compositor) {
        self.kept
            .set_read_timeout(Some(PATIENCE))
            .expect("a socket");
        let read = self.kept.read(&mut [0; 1]);
        assert!(
            matches!(read, Ok(0)),
            "the compositor never let the machine sleep: {read:?}\nit said:\n{}",
            compositor.complaint()
        );
    }
}

struct Manager {
    taken: Sender<Inhibitor>,
}

#[zbus::interface(name = "org.freedesktop.login1.Manager")]
impl Manager {
    fn inhibit(&self, what: String, _who: String, _why: String, mode: String) -> OwnedFd {
        let (kept, handed) = UnixStream::pair().expect("a socket pair");
        self.taken
            .send(Inhibitor { what, mode, kept })
            .expect("the test is listening");
        OwnedFd::from(std::os::fd::OwnedFd::from(handed))
    }

    #[zbus(name = "GetSessionByPID")]
    fn get_session_by_pid(&self, _pid: u32) -> OwnedObjectPath {
        OwnedObjectPath::try_from(SESSION).expect("a path")
    }

    #[zbus(signal)]
    async fn prepare_for_sleep(emitter: &SignalEmitter<'_>, start: bool) -> zbus::Result<()>;
}

struct Session;

#[zbus::interface(name = "org.freedesktop.login1.Session")]
impl Session {
    #[zbus(signal)]
    async fn lock(emitter: &SignalEmitter<'_>) -> zbus::Result<()>;
}
