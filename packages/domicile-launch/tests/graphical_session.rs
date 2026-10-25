use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::{Arc, Mutex};

use domicile_launch::graphical_session::{begin, end, name, SHUTDOWN, TARGET};
use domicile_launch::notification::connected;

/// A call the fake user manager received.
#[derive(Debug, PartialEq)]
enum Heard {
    SetEnvironment(Vec<String>),
    UnsetEnvironment(Vec<String>),
    StartUnit(String, String),
    StopUnit(String, String),
}

struct Manager {
    heard: Arc<Mutex<Vec<Heard>>>,
    environment: Vec<String>,
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

    #[zbus(property)]
    fn environment(&self) -> Vec<String> {
        self.environment.clone()
    }
}

/// A fake user manager and a client, connected peer-to-peer over a socket pair.
fn paired() -> (
    zbus::blocking::Connection,
    zbus::blocking::Connection,
    Arc<Mutex<Vec<Heard>>>,
) {
    paired_with(&[])
}

/// The same, with the manager holding `environment`.
fn paired_with(
    environment: &[&str],
) -> (
    zbus::blocking::Connection,
    zbus::blocking::Connection,
    Arc<Mutex<Vec<Heard>>>,
) {
    let (theirs, ours) = UnixStream::pair().unwrap();
    let heard = Arc::new(Mutex::new(Vec::new()));
    let environment = environment.iter().map(|line| line.to_string()).collect();
    let guid = zbus::Guid::generate();
    let server = std::thread::spawn({
        let heard = Arc::clone(&heard);
        move || {
            zbus::blocking::connection::Builder::async_io_unix_stream(theirs)
                .server(guid)
                .unwrap()
                .p2p()
                .serve_at("/org/freedesktop/systemd1", Manager { heard, environment })
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
fn a_desk_names_its_desktop_before_anything_can_start_the_portal() {
    // The engine starts before the compositor and can D-Bus activate the
    // portal frontend, which reads `XDG_CURRENT_DESKTOP` once, when it starts.
    // So the name is set before any component runs.
    let (_server, client, heard) = paired();
    name(&client).unwrap();
    assert_eq!(
        *heard.lock().unwrap(),
        [Heard::SetEnvironment(vec![
            "XDG_CURRENT_DESKTOP=domicile".into(),
            "XDG_SESSION_TYPE=wayland".into(),
        ])]
    );
}

#[test]
fn a_desk_that_is_the_session_is_said_before_the_session_starts() {
    // Services bound to `graphical-session.target`, such as the portal, read
    // the user manager's environment when they start. So the environment is set
    // before the target starts.
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
    // Stopping the desktop's own target is not enough: a running portal holds
    // `graphical-session.target` up (`Requisite=`) with a stale socket in its
    // environment. The shutdown target conflicts with the graphical session and
    // stops it regardless. Unsetting the variables keeps later services from
    // seeing them.
    let ours = Path::new("/run/d/domicile-ipc.4242.sock");
    let (_server, client, heard) = paired_with(&[
        "WAYLAND_DISPLAY=wayland-1",
        "DOMICILE_SOCK=/run/d/domicile-ipc.4242.sock",
    ]);
    // The desk this one took the session from has exited.
    end(
        &client,
        ours,
        &["DOMICILE_SOCK=/run/d/domicile-ipc.1.sock".to_string()],
    )
    .unwrap();
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

/// The variables a desk at `control` on `display` sets.
fn said(display: &str, control: &Path) -> Vec<String> {
    vec![
        "XDG_CURRENT_DESKTOP=domicile".into(),
        format!("WAYLAND_DISPLAY={display}"),
        format!("DOMICILE_SOCK={}", control.display()),
        "XDG_SESSION_TYPE=wayland".into(),
    ]
}

#[test]
fn a_desk_remembers_the_session_it_takes_over() {
    // A second login session on another tty, so it can hand the session back.
    let earlier = said("wayland-1", Path::new("/run/d/domicile-ipc.1.sock"));
    let mut environment: Vec<&str> = earlier.iter().map(String::as_str).collect();
    environment.push("PATH=/bin");
    let (_server, client, _heard) = paired_with(&environment);
    let taken = begin(
        &client,
        "wayland-2",
        Path::new("/run/d/domicile-ipc.2.sock"),
    )
    .unwrap();
    assert_eq!(taken, earlier);
}

#[test]
fn a_desk_restarting_takes_over_no_session() {
    let ours = Path::new("/run/d/domicile-ipc.2.sock");
    let before = said("wayland-1", ours);
    let environment: Vec<&str> = before.iter().map(String::as_str).collect();
    let (_server, client, _heard) = paired_with(&environment);
    assert_eq!(
        begin(&client, "wayland-2", ours).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn a_desk_that_ends_hands_the_session_back_to_the_desk_it_took_it_from() {
    // The first desk still runs, so its graphical session and its portal stay
    // up, and services it starts find its display again.
    let directory = tempfile::tempdir().unwrap();
    let first = directory.path().join("domicile-ipc.1.sock");
    let _serving = std::os::unix::net::UnixListener::bind(&first).unwrap();
    let ours = directory.path().join("domicile-ipc.2.sock");
    let now = said("wayland-2", &ours);
    let environment: Vec<&str> = now.iter().map(String::as_str).collect();
    let (_server, client, heard) = paired_with(&environment);
    let earlier = said("wayland-1", &first);
    end(&client, &ours, &earlier).unwrap();
    assert_eq!(*heard.lock().unwrap(), [Heard::SetEnvironment(earlier)]);
}

#[test]
fn a_desk_that_ends_after_a_later_desk_took_the_session_leaves_it_alone() {
    let later = said("wayland-2", Path::new("/run/d/domicile-ipc.2.sock"));
    let environment: Vec<&str> = later.iter().map(String::as_str).collect();
    let (_server, client, heard) = paired_with(&environment);
    end(&client, Path::new("/run/d/domicile-ipc.1.sock"), &[]).unwrap();
    assert_eq!(*heard.lock().unwrap(), []);
}
