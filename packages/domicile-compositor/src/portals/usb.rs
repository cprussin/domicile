//! `org.freedesktop.impl.portal.Usb`: the user lets an application open USB
//! devices.
//!
//! The frontend enumerates devices and checks their permissions; this backend
//! names each device (`domicile_host::usb_names`) and asks. The user grants
//! the devices asked for together or none.

use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use domicile_host::usb_names::{database_properties, names};
use domicile_protocol::{PortalAnswer, PortalKind, UsbDevice, UsbDialog};
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

use super::queue::{ask, Queue};

/// The `org.freedesktop.impl.portal.Usb` version implemented.
const INTERFACE_VERSION: u32 = 1;

/// A device as `AcquireDevices` passes it: id, information, access options.
type Asked = (
    String,
    HashMap<String, OwnedValue>,
    HashMap<String, OwnedValue>,
);

/// The `Usb` backend object.
pub struct Usb {
    pub queue: Arc<Queue>,
    /// udev's database, for names the frontend did not pass:
    /// `/run/udev/data`.
    pub udev_data: PathBuf,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Usb")]
impl Usb {
    /// Ask, and answer with every device asked for, or none.
    #[allow(clippy::too_many_arguments)] // The spec's own signature.
    async fn acquire_devices(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        parent_window: String,
        app_id: String,
        devices: Vec<Asked>,
        _options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let kind = PortalKind::Usb(UsbDialog {
            devices: devices
                .iter()
                .map(|(id, information, access)| device(id, information, access, &self.udev_data))
                .collect(),
        });
        match ask(&self.queue, server, handle, app_id, &parent_window, kind).await {
            PortalAnswer::Access => {
                let granted: Vec<(String, HashMap<String, OwnedValue>)> = devices
                    .into_iter()
                    .map(|(id, _, access)| (id, access))
                    .collect();
                (
                    0,
                    HashMap::from([(
                        "devices".to_string(),
                        OwnedValue::try_from(zbus::zvariant::Value::from(granted))
                            .expect("a device list holds no file descriptors"),
                    )]),
                )
            }
            PortalAnswer::Canceled => (1, HashMap::new()),
            // A refusal, or an answer of another kind, which the queue
            // refuses (`accepts`).
            _ => (2, HashMap::new()),
        }
    }

    #[zbus(property(emits_changed_signal = "const"), name = "version")]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

/// One device as the dialog lists it. Names come from the udev `properties`
/// the frontend passed, else from udev's database for its `device-file`. A
/// mistyped key reads as absent.
fn device(
    id: &str,
    information: &HashMap<String, OwnedValue>,
    access: &HashMap<String, OwnedValue>,
    udev_data: &Path,
) -> UsbDevice {
    let passed: HashMap<String, String> = information
        .get("properties")
        .and_then(|value| HashMap::<String, OwnedValue>::try_from(value.try_clone().ok()?).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(key, value)| Some((key, String::try_from(value).ok()?)))
        .collect();
    let (vendor, product) = match names(&passed) {
        (None, None) => information
            .get("device-file")
            .and_then(|value| String::try_from(value.try_clone().ok()?).ok())
            .and_then(|file| std::fs::metadata(file).ok())
            .and_then(|file| {
                let rdev = file.rdev();
                database_properties(udev_data, libc::major(rdev), libc::minor(rdev)).ok()
            })
            .map(|properties| names(&properties))
            .unwrap_or((None, None)),
        named => named,
    };
    UsbDevice {
        id: id.to_string(),
        vendor,
        product,
        writable: access
            .get("writable")
            .and_then(|value| bool::try_from(value).ok())
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    use std::thread;
    use std::time::Duration;

    use domicile_protocol::PortalRequest;
    use zbus::zvariant::{ObjectPath, Value};

    use crate::portals::socket_pair::connected;

    const PATH: &str = "/org/freedesktop/portal/desktop";
    const INTERFACE: &str = "org.freedesktop.impl.portal.Usb";

    struct Served {
        client: zbus::blocking::Connection,
        queue: Arc<Queue>,
        published: Receiver<Vec<PortalRequest>>,
        udev: tempfile::TempDir,
        _server: zbus::blocking::Connection,
    }

    fn served() -> Served {
        let udev = tempfile::tempdir().expect("a directory");
        let queue = Arc::<Queue>::default();
        let (publish, published) = channel();
        queue.listen(
            move |items, _| {
                let _ = publish.send(items);
            },
            || true,
            |_| None,
        );
        let serving = Arc::clone(&queue);
        let udev_data = udev.path().to_path_buf();
        let (server, client) = connected(move |builder| {
            builder
                .serve_at(
                    PATH,
                    Usb {
                        queue: serving,
                        udev_data,
                    },
                )
                .expect("served")
        });
        Served {
            client,
            queue,
            published,
            udev,
            _server: server,
        }
    }

    fn owned(value: Value<'static>) -> OwnedValue {
        OwnedValue::try_from(value).expect("ownable")
    }

    /// A security key the frontend named, asked for writable.
    fn key() -> Asked {
        (
            "dev-1".into(),
            HashMap::from([(
                "properties".to_string(),
                owned(Value::from(HashMap::from([(
                    "ID_VENDOR_FROM_DATABASE".to_string(),
                    Value::from("Yubico.com"),
                )]))),
            )]),
            HashMap::from([("writable".to_string(), OwnedValue::from(true))]),
        )
    }

    /// Call `AcquireDevices` from another thread.
    fn acquire(
        client: &zbus::blocking::Connection,
        devices: Vec<Asked>,
    ) -> thread::JoinHandle<(u32, HashMap<String, OwnedValue>)> {
        let client = client.clone();
        thread::spawn(move || {
            client
                .call_method(
                    None::<&str>,
                    PATH,
                    Some(INTERFACE),
                    "AcquireDevices",
                    &(
                        ObjectPath::try_from("/org/freedesktop/portal/desktop/request/1_7/u")
                            .expect("a path"),
                        "",
                        "org.example.Keys",
                        devices,
                        HashMap::<String, OwnedValue>::new(),
                    ),
                )
                .expect("AcquireDevices answered")
                .body()
                .deserialize()
                .expect("its reply")
        })
    }

    #[track_caller]
    fn next(published: &Receiver<Vec<PortalRequest>>) -> Vec<PortalRequest> {
        published
            .recv_timeout(Duration::from_secs(10))
            .expect("the queue published")
    }

    #[test]
    fn a_grant_hands_back_every_device_asked_for() {
        let served = served();
        let asking = acquire(&served.client, vec![key()]);

        assert_eq!(
            next(&served.published)
                .into_iter()
                .map(|request| request.kind)
                .collect::<Vec<_>>(),
            [PortalKind::Usb(UsbDialog {
                devices: vec![UsbDevice {
                    id: "dev-1".into(),
                    vendor: Some("Yubico.com".into()),
                    product: None,
                    writable: true,
                }],
            })]
        );
        served.queue.answer(1, PortalAnswer::Access);

        let (response, results) = asking.join().expect("the call returned");
        assert_eq!(response, 0);
        let granted = <Vec<(String, HashMap<String, OwnedValue>)>>::try_from(
            results
                .get("devices")
                .expect("the devices")
                .try_clone()
                .expect("cloned"),
        )
        .expect("a(sa{sv})");
        assert_eq!(granted.len(), 1);
        assert_eq!(granted[0].0, "dev-1");
        assert_eq!(
            granted[0].1.get("writable").map(bool::try_from),
            Some(Ok(true))
        );
    }

    #[test]
    fn a_dismissed_grant_hands_back_nothing() {
        let served = served();
        let asking = acquire(&served.client, vec![key()]);
        next(&served.published);
        served.queue.answer(1, PortalAnswer::Canceled);

        let (response, results) = asking.join().expect("the call returned");
        assert_eq!(response, 1);
        assert!(results.is_empty());
    }

    #[test]
    fn a_device_the_frontend_did_not_name_is_named_from_udev() {
        let served = served();
        // A regular file's `rdev` is 0:0.
        let file = served.udev.path().join("not-a-device");
        std::fs::write(&file, b"").expect("written");
        std::fs::write(
            served.udev.path().join("c0:0"),
            "E:ID_VENDOR_FROM_DATABASE=Nintendo Co., Ltd\nE:ID_MODEL=Pro_Controller\n",
        )
        .expect("the udev entry is written");
        let pad = (
            "dev-2".to_string(),
            HashMap::from([(
                "device-file".to_string(),
                owned(Value::from(file.to_string_lossy().into_owned())),
            )]),
            HashMap::new(),
        );

        let asking = acquire(&served.client, vec![pad]);

        let kinds: Vec<_> = next(&served.published)
            .into_iter()
            .map(|request| request.kind)
            .collect();
        assert_eq!(
            kinds,
            [PortalKind::Usb(UsbDialog {
                devices: vec![UsbDevice {
                    id: "dev-2".into(),
                    vendor: Some("Nintendo Co., Ltd".into()),
                    product: Some("Pro Controller".into()),
                    writable: false,
                }],
            })]
        );
        served.queue.answer(1, PortalAnswer::Canceled);
        asking.join().expect("the call returned");
    }
}
