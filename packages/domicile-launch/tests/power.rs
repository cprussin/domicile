//! Tests for asking before powering off or rebooting.

use std::collections::HashMap;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex};

use domicile_launch::notification::connected;
use domicile_launch::power::{confirmed, Power};
use domicile_protocol::SHELL_APP_ID;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

/// What one `AccessDialog` was asked.
#[derive(Debug, PartialEq)]
struct Asked {
    handle: String,
    app_id: String,
    title: String,
    subtitle: String,
    grant: String,
    deny: String,
    destructive: bool,
}

/// An Access portal that answers every `AccessDialog` with `response`.
struct Portal {
    response: u32,
    asked: Arc<Mutex<Vec<Asked>>>,
}

/// A string option's value.
fn text(options: &HashMap<String, OwnedValue>, key: &str) -> String {
    String::try_from(options[key].try_clone().unwrap()).unwrap()
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Access")]
impl Portal {
    #[allow(clippy::too_many_arguments)] // The portal's signature.
    async fn access_dialog(
        &self,
        handle: OwnedObjectPath,
        app_id: String,
        _parent_window: String,
        title: String,
        subtitle: String,
        _body: String,
        options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        self.asked.lock().unwrap().push(Asked {
            handle: handle.to_string(),
            app_id,
            title,
            subtitle,
            grant: text(&options, "grant_label"),
            deny: text(&options, "deny_label"),
            destructive: bool::try_from(&options["destructive"]).unwrap(),
        });
        (self.response, HashMap::new())
    }
}

/// The client's end of a fake Access portal answering `response`, and what
/// each dialog was asked.
fn a_portal(
    response: u32,
) -> (
    zbus::blocking::Connection,
    zbus::blocking::Connection,
    Arc<Mutex<Vec<Asked>>>,
) {
    let (theirs, ours) = UnixStream::pair().unwrap();
    let asked = Arc::new(Mutex::new(Vec::new()));
    let portal = Portal {
        response,
        asked: Arc::clone(&asked),
    };
    let guid = zbus::Guid::generate();
    let server = std::thread::spawn(move || {
        zbus::blocking::connection::Builder::async_io_unix_stream(theirs)
            .server(guid)
            .unwrap()
            .p2p()
            .serve_at("/org/freedesktop/portal/desktop", portal)
            .unwrap()
            .build()
            .unwrap()
    });
    let client =
        connected(zbus::blocking::connection::Builder::async_io_unix_stream(ours).p2p()).unwrap();
    (server.join().unwrap(), client, asked)
}

#[test]
fn power_off_asks_in_the_access_dialog() {
    let (_server, client, asked) = a_portal(0);
    assert_eq!(confirmed(&client, Power::Off), Ok(true));
    assert_eq!(
        *asked.lock().unwrap(),
        [Asked {
            handle: format!(
                "/org/freedesktop/portal/desktop/request/launcher/shutdown_{}",
                std::process::id()
            ),
            app_id: SHELL_APP_ID.to_string(),
            title: "Shut down?".to_string(),
            subtitle: String::new(),
            grant: "Shut down".to_string(),
            deny: "Cancel".to_string(),
            destructive: true,
        }]
    );
}

#[test]
fn reboot_asks_its_own_question() {
    let (_server, client, asked) = a_portal(0);
    assert_eq!(confirmed(&client, Power::Reboot), Ok(true));
    let asked = asked.lock().unwrap();
    assert!(asked[0].handle.contains("/launcher/reboot_"));
    assert_eq!(asked[0].title, "Reboot?");
    assert_eq!(asked[0].grant, "Reboot");
}

#[test]
fn a_canceled_or_unanswered_dialog_is_a_no() {
    // 2 is the portal's "ended some other way", such as no shell to ask.
    for response in [1, 2] {
        let (_server, client, _) = a_portal(response);
        assert_eq!(confirmed(&client, Power::Off), Ok(false));
    }
}

#[test]
fn an_unknown_answer_is_an_error() {
    let (_server, client, _) = a_portal(7);
    assert!(confirmed(&client, Power::Off).is_err());
}

#[test]
fn each_runs_systemctl_ignoring_inhibitors() {
    assert_eq!(Power::Off.systemctl(), ["poweroff", "-i"]);
    assert_eq!(Power::Reboot.systemctl(), ["reboot", "-i"]);
}
