//! RemoteDesktop and its Clipboard over a real session bus.
//!
//! A private `dbus-daemon` stands in for the session bus and the test for
//! `xdg-desktop-portal`. The test chrome answers the dialog, a `reis` client
//! types into a window, and `wl-copy` and `wl-paste` share the clipboard with
//! the session. The backends' own logic is unit-tested in `src/portals/`.

mod running;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::process::Stdio;

use domicile_protocol::{
    ChromeMessage, Devices, HostMessage, PortalAnswer, PortalKind, RemoteDesktopDialog,
};
use reis::ei;
use reis::event::EiEvent;
use zbus::blocking::{Connection, MessageIterator};
use zbus::zvariant::{ObjectPath, OwnedValue, Value};
use zbus::MatchRule;

use crate::running::bus::Bus;
use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

const BACKEND: &str = "org.freedesktop.impl.portal.desktop.domicile";
const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";
const REMOTE_DESKTOP: &str = "org.freedesktop.impl.portal.RemoteDesktop";
const CLIPBOARD: &str = "org.freedesktop.impl.portal.Clipboard";
const SESSION: &str = "/org/freedesktop/portal/desktop/session/1_9/remote";
const TEXT: &str = "text/plain;charset=utf-8";

type Options = HashMap<String, OwnedValue>;

fn call<B>(
    connection: &Connection,
    interface: &str,
    method: &str,
    body: &B,
) -> zbus::message::Message
where
    B: zbus::export::serde::Serialize + zbus::zvariant::DynamicType,
{
    connection
        .call_method(Some(BACKEND), OBJECT_PATH, Some(interface), method, body)
        .unwrap_or_else(|why| panic!("{method} failed: {why}"))
}

fn path(path: &str) -> ObjectPath<'_> {
    ObjectPath::try_from(path).expect("a path")
}

fn signals(connection: &Connection, member: &'static str) -> MessageIterator {
    MessageIterator::for_match_rule(
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface(CLIPBOARD)
            .expect("a name")
            .member(member)
            .expect("a name")
            .build(),
        connection,
        None,
    )
    .expect("listening")
}

/// The fd a call answered with.
fn fd(message: zbus::message::Message) -> OwnedFd {
    let fd: zbus::zvariant::OwnedFd = message.body().deserialize().expect("an fd");
    fd.into()
}

/// A remote desktop session granted the keyboard and the clipboard: the
/// application asks, and the chrome answers.
fn granted(connection: &Connection, chrome: &mut domicile_test_chrome::Chrome) {
    call(
        connection,
        REMOTE_DESKTOP,
        "CreateSession",
        &(
            path("/r/1"),
            path(SESSION),
            "org.example.Remote",
            Options::new(),
        ),
    );
    let keyboard = HashMap::from([("types", Value::from(1u32))]);
    call(
        connection,
        REMOTE_DESKTOP,
        "SelectDevices",
        &(path("/r/2"), path(SESSION), "org.example.Remote", keyboard),
    );
    call(
        connection,
        CLIPBOARD,
        "RequestClipboard",
        &(path(SESSION), Options::new()),
    );
    let starting = {
        let connection = connection.clone();
        std::thread::spawn(move || {
            let started = call(
                &connection,
                REMOTE_DESKTOP,
                "Start",
                &(
                    path("/r/3"),
                    path(SESSION),
                    "org.example.Remote",
                    "",
                    Options::new(),
                ),
            );
            let (response, results): (u32, Options) =
                started.body().deserialize().expect("Start's reply");
            (response, results)
        })
    };
    let asked = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::PortalRequests { items, .. } if !items.is_empty())
        })
        .expect("the dialog reaches the chrome");
    let HostMessage::PortalRequests { items, .. } = asked else {
        unreachable!("the wait matched on this variant")
    };
    let keyboard_only = Devices {
        keyboard: true,
        ..Devices::default()
    };
    assert_eq!(
        items[0].kind,
        PortalKind::RemoteDesktop(RemoteDesktopDialog {
            devices: keyboard_only,
            clipboard: true,
        })
    );
    chrome
        .say(&ChromeMessage::AnswerPortalRequest {
            id: items[0].id,
            answer: PortalAnswer::RemoteDesktop {
                devices: keyboard_only,
                clipboard: true,
            },
        })
        .expect("the chrome socket takes an answer");
    let (response, results) = starting.join().expect("Start returned");
    assert_eq!(response, 0);
    assert_eq!(
        results.get("clipboard_enabled"),
        Some(&OwnedValue::from(true))
    );
}

/// Press and release `key` from an EIS client on `socket`.
fn type_over_eis(socket: OwnedFd, key: u32) {
    let context = ei::Context::new(UnixStream::from(socket)).expect("a context");
    let (connection, events) = context
        .handshake_blocking("domicile portal test", ei::handshake::ContextType::Sender)
        .expect("the handshake");
    for event in events {
        match event.expect("an event") {
            EiEvent::SeatAdded(added) => {
                added
                    .seat
                    .bind_capabilities(reis::event::DeviceCapability::Keyboard.into());
                connection.flush().expect("flushed");
            }
            EiEvent::DeviceResumed(resumed) => {
                let device = resumed.device;
                let keyboard = device.interface::<ei::Keyboard>().expect("a keyboard");
                device.device().start_emulating(connection.serial(), 1);
                keyboard.key(key, ei::keyboard::KeyState::Press);
                device.device().frame(connection.serial(), 1);
                keyboard.key(key, ei::keyboard::KeyState::Released);
                device.device().frame(connection.serial(), 2);
                connection.flush().expect("flushed");
                return;
            }
            _ => {}
        }
    }
}

/// Give the keyboard to the window with this title, and wait until it has it.
fn focus(chrome: &mut domicile_test_chrome::Chrome, title: &str) {
    let named = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::AppAppeared { title: Some(named), .. } if named == title)
        })
        .expect("a client that named its window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = named else {
        unreachable!("the wait matched on this variant")
    };
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes a focus");
    chrome
        .wait_for(|message| {
            matches!(message, HostMessage::FocusChanged { app_id: Some(moved) } if *moved == app_id)
        })
        .expect("the keyboard moves to the window the chrome named");
}

#[test]
fn a_remote_desktop_session_types_into_the_focused_window() {
    let bus = Bus::started();
    let compositor = Compositor::started_on_a_bus(ONE_DISPLAY, &bus.address);
    let mut chrome = compositor.chrome();
    let mut typed_into = compositor.client("typed into");
    focus(&mut chrome, "typed into");
    let connection = bus.client_once(BACKEND);
    granted(&connection, &mut chrome);

    let socket = fd(call(
        &connection,
        REMOTE_DESKTOP,
        "ConnectToEIS",
        &(path(SESSION), "org.example.Remote", Options::new()),
    ));
    type_over_eis(socket, 30);

    assert!(
        typed_into.wait_for_trace(", 30, 1)", 1),
        "the focused window never got the key; it traced:\n{}\nthe compositor said:\n{}",
        typed_into.trace(),
        compositor.complaint()
    );
}

#[test]
fn a_remote_desktop_session_shares_the_clipboard_both_ways() {
    let bus = Bus::started();
    let compositor = Compositor::started_on_a_bus(ONE_DISPLAY, &bus.address);
    let mut chrome = compositor.chrome();
    let connection = bus.client_once(BACKEND);
    granted(&connection, &mut chrome);

    // The application's copy, pasted by `wl-paste`.
    let transfers = signals(&connection, "SelectionTransfer");
    let offer = HashMap::from([("mime_types", Value::from(vec![TEXT]))]);
    call(
        &connection,
        CLIPBOARD,
        "SetSelection",
        &(path(SESSION), offer),
    );
    let pasting = compositor
        .command("wl-paste")
        .args(["--no-newline", "--type", TEXT])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("wl-paste starts; it is in `nix develop .#full`");
    let transfer = transfers
        .into_iter()
        .next()
        .expect("a signal")
        .expect("read");
    let (_, _, serial): (zbus::zvariant::OwnedObjectPath, String, u32) =
        transfer.body().deserialize().expect("its arguments");
    {
        // Its own connection, dropped after: a connection keeps a copy of
        // every fd it is sent, and `wl-paste` reads until the pipe closes.
        let writing = bus.client_once(BACKEND);
        let pipe = fd(call(
            &writing,
            CLIPBOARD,
            "SelectionWrite",
            &(path(SESSION), serial),
        ));
        std::fs::File::from(pipe)
            .write_all(b"from afar")
            .expect("the paste is written");
    }
    call(
        &connection,
        CLIPBOARD,
        "SelectionWriteDone",
        &(path(SESSION), serial, true),
    );
    let pasted = pasting.wait_with_output().expect("wl-paste finishes");
    assert_eq!(String::from_utf8_lossy(&pasted.stdout), "from afar");

    // `wl-copy`'s copy, read by the application.
    let changes = signals(&connection, "SelectionOwnerChanged");
    let mut copying = compositor
        .command("wl-copy")
        .args(["--foreground", "--", "copied here"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("wl-copy starts");
    let changed = changes
        .into_iter()
        .map(|signal| signal.expect("read"))
        .find(|signal| {
            let (_, options): (zbus::zvariant::OwnedObjectPath, Options) =
                signal.body().deserialize().expect("its arguments");
            options.get("session_is_owner") == Some(&OwnedValue::from(false))
        });
    assert!(changed.is_some(), "the session hears another client copy");
    let mut read = String::new();
    std::fs::File::from(fd(call(
        &connection,
        CLIPBOARD,
        "SelectionRead",
        &(path(SESSION), TEXT),
    )))
    .read_to_string(&mut read)
    .expect("the clipboard is read");
    copying.kill().expect("wl-copy stops");
    copying.wait().expect("wl-copy is reaped");

    assert_eq!(read, "copied here");
}
