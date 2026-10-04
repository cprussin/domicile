use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::{Arc, Mutex};

use domicile_launch::graphical_session::{begin, end, SHUTDOWN, TARGET};
use domicile_launch::notification::connected;

/// One call, as the user manager heard it.
#[derive(Debug, PartialEq)]
enum Heard {
    SetEnvironment(Vec<String>),
    UnsetEnvironment(Vec<String>),
    StartUnit(String, String),
    StopUnit(String, String),
}

struct Manager {
    heard: Arc<Mutex<Vec<Heard>>>,
}

#[zbus::interface(name = "org.freedesktop.systemd1.Manager")]
impl Manager {
    fn set_environment(&self, assignments: Vec<String>) {
        self.heard
            .lock()
            .unwrap()
            .push(Heard::SetEnvironment(assignments));
    }

    fn unset_environment(&self, names: Vec<String>) {
        self.heard
            .lock()
            .unwrap()
            .push(Heard::UnsetEnvironment(names));
    }

    fn start_unit(&self, name: String, mode: String) -> zbus::zvariant::OwnedObjectPath {
        self.heard
            .lock()
            .unwrap()
            .push(Heard::StartUnit(name, mode));
        zbus::zvariant::OwnedObjectPath::try_from("/org/freedesktop/systemd1/job/1").unwrap()
    }

    fn stop_unit(&self, name: String, mode: String) -> zbus::zvariant::OwnedObjectPath {
        self.heard.lock().unwrap().push(Heard::StopUnit(name, mode));
        zbus::zvariant::OwnedObjectPath::try_from("/org/freedesktop/systemd1/job/2").unwrap()
    }
}

/// A user manager and a client over one socket pair, with no bus between them.
fn paired() -> (
    zbus::blocking::Connection,
    zbus::blocking::Connection,
    Arc<Mutex<Vec<Heard>>>,
) {
    let (theirs, ours) = UnixStream::pair().unwrap();
    let heard = Arc::new(Mutex::new(Vec::new()));
    let guid = zbus::Guid::generate();
    let server = std::thread::spawn({
        let heard = Arc::clone(&heard);
        move || {
            zbus::blocking::connection::Builder::async_io_unix_stream(theirs)
                .server(guid)
                .unwrap()
                .p2p()
                .serve_at("/org/freedesktop/systemd1", Manager { heard })
                .unwrap()
                .build()
                .unwrap()
        }
    });
    let client =
        connected(zbus::blocking::connection::Builder::async_io_unix_stream(ours).p2p()).unwrap();
    (server.join().unwrap(), client, heard)
}

#[test]
fn a_desk_that_is_the_session_is_said_before_the_session_starts() {
    // `graphical-session.target` is what the portal -- and every service a
    // home binds to a graphical session -- waits on, and each of them takes
    // the user manager's environment as it starts. So the desk is said first:
    // which desktop this is, the display its apps open on, and the control
    // socket `domicile-open-url` finds it by. Only then does the target start.
    let (_server, client, heard) = paired();
    begin(
        &client,
        "wayland-1",
        Path::new("/run/d/domicile-ipc.4242.sock"),
    )
    .unwrap();
    assert_eq!(
        *heard.lock().unwrap(),
        [
            Heard::SetEnvironment(vec![
                "XDG_CURRENT_DESKTOP=domicile".into(),
                "WAYLAND_DISPLAY=wayland-1".into(),
                "DOMICILE_SOCK=/run/d/domicile-ipc.4242.sock".into(),
                "XDG_SESSION_TYPE=wayland".into(),
            ]),
            Heard::StartUnit(TARGET.into(), "replace".into()),
        ]
    );
}

#[test]
fn a_desk_that_ends_takes_its_session_and_its_variables_with_it() {
    // Stopping the desk's own target is not enough: a running portal holds
    // `graphical-session.target` up (`Requisite=` pins it), and with it the
    // portal itself, a dead desk's socket in its environment. The shutdown
    // target conflicts with the graphical session and takes it down whatever
    // holds it. Then the variables go, so nothing started later finds them.
    let (_server, client, heard) = paired();
    end(&client).unwrap();
    assert_eq!(
        *heard.lock().unwrap(),
        [
            Heard::StartUnit(SHUTDOWN.into(), "replace-irreversibly".into()),
            Heard::UnsetEnvironment(vec![
                "XDG_CURRENT_DESKTOP".into(),
                "WAYLAND_DISPLAY".into(),
                "DOMICILE_SOCK".into(),
                "XDG_SESSION_TYPE".into(),
            ]),
        ]
    );
}
