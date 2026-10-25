//! A second desk on the same session bus, in a window or on another tty.
//!
//! The first desk keeps its bus names while a desk in a window runs, and gets
//! them back when a second login session exits. A private `dbus-daemon`
//! stands in for the session bus.

mod running;

use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use zbus::blocking::fdo::DBusProxy;
use zbus::blocking::MessageIterator;
use zbus::{message, MatchRule};

use crate::running::bus::Bus;
use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// The names an app reaches a desk by.
const NAMES: [&str; 3] = [
    "org.freedesktop.impl.portal.desktop.domicile",
    "org.freedesktop.Notifications",
    "org.kde.StatusNotifierWatcher",
];

/// How long a desk gets to take or queue for a name.
const PATIENCE: Duration = Duration::from_secs(20);

/// `WAYLAND_DISPLAY` for a desk that is the login session.
const NO_HOST: [(&str, &str); 1] = [("WAYLAND_DISPLAY", "")];

/// The pids in `name`'s queue, owner first.
fn queue(bus: &DBusProxy<'_>, name: &str) -> Vec<u32> {
    let queued = match bus.list_queued_owners(name.try_into().expect("a name")) {
        Ok(queued) => queued,
        Err(zbus::fdo::Error::NameHasNoOwner(_)) => Vec::new(),
        Err(why) => panic!("the bus did not list {name}'s queue: {why}"),
    };
    queued
        .into_iter()
        .map(|unique| {
            bus.get_connection_unix_process_id(unique.into())
                .expect("the bus knows a queued pid")
        })
        .collect()
}

/// The pid owning `name`, if any.
fn owner(bus: &DBusProxy<'_>, name: &str) -> Option<u32> {
    queue(bus, name).first().copied()
}

/// Waits until `wanted` holds for every name in [`NAMES`].
fn until(bus: &DBusProxy<'_>, what: &str, wanted: impl Fn(&str) -> bool) {
    let deadline = Instant::now() + PATIENCE;
    for name in NAMES {
        while !wanted(name) {
            assert!(
                Instant::now() < deadline,
                "{name}: {what}; the queue is {:?}",
                queue(bus, name)
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

#[test]
fn a_desk_in_a_window_leaves_the_sessions_names_alone() {
    let bus = Bus::started();
    let client = bus.client();
    let proxy = DBusProxy::new(&client).expect("the bus");
    let session = Compositor::started_with_env(
        ONE_DISPLAY,
        None,
        &[("DBUS_SESSION_BUS_ADDRESS", &bus.address), NO_HOST[0]],
    );
    until(&proxy, "the session never took it", |name| {
        owner(&proxy, name) == Some(session.pid())
    });

    let nested = Compositor::started_on_a_bus(ONE_DISPLAY, &bus.address);
    until(&proxy, "the nested desk never queued for it", |name| {
        queue(&proxy, name).contains(&nested.pid())
    });
    for name in NAMES {
        assert_eq!(
            owner(&proxy, name),
            Some(session.pid()),
            "{name} moved to the nested desk"
        );
    }
    drop(nested);
    until(&proxy, "the session lost it", |name| {
        queue(&proxy, name) == [session.pid()]
    });
}

/// The `WAYLAND_DISPLAY` each `UpdateActivationEnvironment` call names, with
/// the pid of its caller, from here on.
fn activation_calls(bus: &Bus) -> Receiver<(u32, Option<String>)> {
    let monitor = bus.client();
    let names = bus.client();
    let rule = MatchRule::builder()
        .msg_type(message::Type::MethodCall)
        .interface("org.freedesktop.DBus")
        .expect("an interface")
        .member("UpdateActivationEnvironment")
        .expect("a member")
        .build();
    monitor
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus.Monitoring"),
            "BecomeMonitor",
            &(vec![rule.to_string()], 0u32),
        )
        .expect("the bus takes a monitor");
    let (heard, calls) = channel();
    std::thread::spawn(move || {
        let names = DBusProxy::new(&names).expect("the bus");
        for call in MessageIterator::from(monitor) {
            let call = call.expect("a message");
            // The bus also sends a monitor its own messages, such as
            // `NameLost` for the monitor's unique name.
            if !rule.matches(&call).expect("a rule to match") {
                continue;
            }
            let sender = call.header().sender().expect("a caller").to_owned();
            // A caller that has since exited has no pid, and is not the
            // desk this waits for.
            let Ok(pid) = names.get_connection_unix_process_id(sender.into()) else {
                continue;
            };
            let environment: HashMap<String, String> =
                call.body().deserialize().expect("an environment");
            if heard
                .send((pid, environment.get("WAYLAND_DISPLAY").cloned()))
                .is_err()
            {
                break;
            }
        }
    });
    calls
}

#[test]
fn a_second_session_hands_the_desk_back_when_it_exits() {
    let bus = Bus::started();
    let client = bus.client();
    let proxy = DBusProxy::new(&client).expect("the bus");
    let env = [
        ("DBUS_SESSION_BUS_ADDRESS", bus.address.as_str()),
        NO_HOST[0],
    ];
    let first = Compositor::started_with_env(ONE_DISPLAY, None, &env);
    until(&proxy, "the first session never took it", |name| {
        owner(&proxy, name) == Some(first.pid())
    });

    // The session the user just logged in to is the one in front.
    let second = Compositor::started_with_env(ONE_DISPLAY, None, &env);
    until(&proxy, "the second session never took it", |name| {
        owner(&proxy, name) == Some(second.pid())
    });
    let calls = activation_calls(&bus);
    drop(second);
    until(&proxy, "the first session never got it back", |name| {
        owner(&proxy, name) == Some(first.pid())
    });
    // Apps D-Bus starts directly open on the first session's display again.
    let deadline = Instant::now() + PATIENCE;
    let said = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match calls.recv_timeout(left) {
            Ok((pid, display)) if pid == first.pid() => break display,
            Ok(_) => {}
            Err(why) => panic!("the first session never said its display again: {why}"),
        }
    };
    assert_eq!(said.as_deref(), Some(first.wayland_display()));
}
