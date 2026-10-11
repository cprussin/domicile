//! Tests for asking the FileChooser portal for a folder.

use std::collections::HashMap;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use domicile_launch::folder_chooser::choose_folder;
use domicile_launch::notification::connected;
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};

/// Where the fake portal says each request lives.
const REQUEST: &str = "/org/freedesktop/portal/desktop/request/1_1/domicile1";

/// The options each `OpenFile` was sent with.
type Asked = Arc<Mutex<Vec<HashMap<String, OwnedValue>>>>;

/// A FileChooser that answers every `OpenFile` with `response` and `uris`.
struct Portal {
    response: u32,
    uris: Vec<String>,
    asked: Asked,
}

#[zbus::interface(name = "org.freedesktop.portal.FileChooser")]
impl Portal {
    async fn open_file(
        &self,
        #[zbus(connection)] connection: &zbus::Connection,
        _parent_window: String,
        _title: String,
        options: HashMap<String, OwnedValue>,
    ) -> OwnedObjectPath {
        self.asked.lock().unwrap().push(options);
        let results = HashMap::from([("uris", Value::from(self.uris.clone()))]);
        connection
            .emit_signal(
                None::<()>,
                REQUEST,
                "org.freedesktop.portal.Request",
                "Response",
                &(self.response, results),
            )
            .await
            .unwrap();
        ObjectPath::try_from(REQUEST).unwrap().into()
    }
}

/// The client's end of a fake portal answering `response` with `uris`, and
/// the options each request was sent with.
fn a_portal(
    response: u32,
    uris: &[&str],
) -> (
    zbus::blocking::Connection,
    zbus::blocking::Connection,
    Asked,
) {
    let (theirs, ours) = UnixStream::pair().unwrap();
    let asked = Arc::new(Mutex::new(Vec::new()));
    let portal = Portal {
        response,
        uris: uris.iter().map(|uri| uri.to_string()).collect(),
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
fn the_chosen_folder_is_its_path() {
    let (_server, client, asked) = a_portal(0, &["file:///home/me/src/my%20extension"]);
    assert_eq!(
        choose_folder(&client, "Load an unpacked extension"),
        Ok(Some(PathBuf::from("/home/me/src/my extension")))
    );
    let asked = asked.lock().unwrap();
    assert_eq!(
        asked[0]
            .get("directory")
            .map(|value| bool::try_from(value).unwrap()),
        Some(true)
    );
}

#[test]
fn a_canceled_chooser_chose_nothing() {
    let (_server, client, _) = a_portal(1, &[]);
    assert_eq!(
        choose_folder(&client, "Load an unpacked extension"),
        Ok(None)
    );
}

#[test]
fn a_chooser_that_failed_says_so() {
    let (_server, client, _) = a_portal(2, &[]);
    assert!(choose_folder(&client, "Load an unpacked extension").is_err());
}
