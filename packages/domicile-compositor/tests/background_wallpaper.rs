//! The Background and Wallpaper portals over a real session bus.
//!
//! A private `dbus-daemon` stands in for the session bus and the test for
//! `xdg-desktop-portal`. These check what the unit tests in `src/portals/`
//! cannot: real windows and focus reach `GetAppState`, and a picture set
//! reaches the chrome.

mod running;

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};
use zbus::blocking::Connection;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

const BACKEND: &str = "org.freedesktop.impl.portal.desktop.domicile";
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";
const BACKGROUND: &str = "org.freedesktop.impl.portal.Background";
const WALLPAPER: &str = "org.freedesktop.impl.portal.Wallpaper";
/// The app id `domicile-test-client` gives its window.
const TEST_CLIENT: &str = "dev.domicile.test-client";
const PATIENCE: Duration = Duration::from_secs(20);

/// A private session bus. Stopped on drop.
struct Bus {
    daemon: Child,
    address: String,
    _directory: tempfile::TempDir,
}

impl Bus {
    /// A bus with its own config, since a distribution's `session.conf` may be
    /// missing or name things this machine lacks.
    fn started() -> Bus {
        let directory = tempfile::tempdir().expect("a directory");
        let config = directory.path().join("bus.conf");
        std::fs::write(
            &config,
            format!(
                r#"<busconfig>
  <type>session</type>
  <listen>unix:path={}</listen>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>"#,
                directory.path().join("bus").display()
            ),
        )
        .expect("the config is written");
        let mut daemon = Command::new("dbus-daemon")
            .arg("--nofork")
            .arg("--print-address")
            .arg(format!("--config-file={}", config.display()))
            .stdout(Stdio::piped())
            .spawn()
            .expect("dbus-daemon starts; it is in `nix develop .#full`");
        let mut address = String::new();
        BufReader::new(daemon.stdout.take().expect("stdout was piped"))
            .read_line(&mut address)
            .expect("dbus-daemon prints its address");
        assert!(!address.trim().is_empty(), "dbus-daemon gave no address");
        Bus {
            daemon,
            address: address.trim().to_string(),
            _directory: directory,
        }
    }

    /// A client on the bus, once the compositor has taken the backend's name.
    fn client(&self) -> Connection {
        let connection = zbus::blocking::connection::Builder::address(self.address.as_str())
            .expect("an address")
            .build()
            .expect("the bus takes a client");
        let bus = zbus::blocking::fdo::DBusProxy::new(&connection).expect("the bus");
        let until = Instant::now() + PATIENCE;
        while !bus
            .name_has_owner(BACKEND.try_into().expect("a name"))
            .expect("the bus answers")
        {
            assert!(
                Instant::now() < until,
                "the compositor never took {BACKEND}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        connection
    }
}

impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
    }
}

/// `GetAppState`, read until `wanted` holds.
fn app_states_until(
    connection: &Connection,
    wanted: impl Fn(&HashMap<String, u32>) -> bool,
) -> HashMap<String, u32> {
    let until = Instant::now() + PATIENCE;
    loop {
        let states: HashMap<String, OwnedValue> = connection
            .call_method(
                Some(BACKEND),
                OBJECT_PATH,
                Some(BACKGROUND),
                "GetAppState",
                &(),
            )
            .expect("GetAppState answered")
            .body()
            .deserialize()
            .expect("the states");
        let states = states
            .into_iter()
            .map(|(app_id, state)| (app_id, u32::try_from(state).expect("a u")))
            .collect();
        if wanted(&states) {
            return states;
        }
        assert!(Instant::now() < until, "GetAppState stayed {states:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_window_and_its_focus_are_its_application_s_state() {
    let bus = Bus::started();
    let compositor = Compositor::started_with_env(
        ONE_DISPLAY,
        None,
        &[("DBUS_SESSION_BUS_ADDRESS", &bus.address)],
    );
    let connection = bus.client();
    let mut chrome = compositor.chrome();
    let client = compositor.client("chat");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the client's window maps");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("matched above");
    };

    app_states_until(&connection, |states| states.get(TEST_CLIENT) == Some(&1));
    chrome
        .say(&ChromeMessage::FocusApp { app_id })
        .expect("the chrome socket takes a focus");
    app_states_until(&connection, |states| states.get(TEST_CLIENT) == Some(&2));

    drop(client);
    app_states_until(&connection, |states| states.is_empty());
}

#[test]
fn a_picture_set_reaches_the_chrome() {
    let bus = Bus::started();
    let state = tempfile::tempdir().expect("a directory");
    let compositor = Compositor::started_with_env(
        ONE_DISPLAY,
        None,
        &[
            ("DBUS_SESSION_BUS_ADDRESS", &bus.address),
            ("XDG_STATE_HOME", &state.path().to_string_lossy()),
        ],
    );
    let connection = bus.client();
    let mut chrome = compositor.chrome();
    let sky = compositor.scratch_file("sky.png");
    std::fs::write(&sky, b"sky").expect("the picture is written");

    let options = HashMap::from([(
        "set-on".to_string(),
        OwnedValue::try_from(Value::from("lockscreen")).expect("ownable"),
    )]);
    let response: u32 = connection
        .call_method(
            Some(BACKEND),
            OBJECT_PATH,
            Some(WALLPAPER),
            "SetWallpaperURI",
            &(
                ObjectPath::try_from("/org/freedesktop/portal/desktop/request/1_1/w")
                    .expect("a path"),
                "org.example.Photos",
                "",
                format!("file://{}", sky.display()),
                options,
            ),
        )
        .expect("SetWallpaperURI answered")
        .body()
        .deserialize()
        .expect("a response");
    assert_eq!(response, 0);

    let told = chrome
        .wait_for(|message| match message {
            HostMessage::PortalRequests { wallpaper, .. } => wallpaper.lockscreen.is_some(),
            _ => false,
        })
        .expect("the chrome is told the picture");
    let HostMessage::PortalRequests { wallpaper, .. } = told else {
        unreachable!("matched above");
    };
    let copy = wallpaper.lockscreen.expect("the lock screen's picture");
    assert!(copy.starts_with(&*state.path().to_string_lossy()), "{copy}");
    assert_eq!(std::fs::read(copy).expect("the copy is there"), b"sky");
    assert_eq!(wallpaper.background, None);
}
