//! `org.freedesktop.impl.portal.DynamicLauncher`: the user confirms a
//! launcher an application would install, and may rename it.
//!
//! The frontend writes the `.desktop` file and icon itself, under
//! `$XDG_DATA_HOME/xdg-desktop-portal/`, and links them into `applications/`
//! and `icons/`, where the shell's desktop entries find them. This backend
//! only asks.
//!
//! **Install tokens:** `RequestInstallToken` lets an application install
//! without the dialog. No application is trusted with one, so every install is
//! confirmed. See `packages/domicile-compositor/src/portals/README.md`.

use std::collections::HashMap;
use std::sync::Arc;

use domicile_host::launcher_icon::icon_url;
use domicile_protocol::{LauncherDialog, LauncherType, PortalAnswer, PortalKind};
use tracing::debug;
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::queue::{ask, Queue};

/// `SupportedLauncherTypes`: applications (`1`) and web apps (`2`).
const SUPPORTED_LAUNCHER_TYPES: u32 = 1 | 2;

/// The `launcher_type` for a web app.
const WEBAPP: u32 = 2;

/// The `org.freedesktop.impl.portal.DynamicLauncher` version implemented.
const INTERFACE_VERSION: u32 = 1;

/// The `DynamicLauncher` backend object.
pub struct DynamicLauncher {
    pub queue: Arc<Queue>,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.DynamicLauncher")]
impl DynamicLauncher {
    /// Ask, and answer with the name the user chose and the icon unchanged.
    #[allow(clippy::too_many_arguments)] // The spec's own signature.
    async fn prepare_install(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        name: String,
        icon_v: OwnedValue,
        options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let (kind, modal) = asked(name, &icon_v, options);
        let parent_window = if modal { parent_window.as_str() } else { "" };
        match ask(&self.queue, server, handle, app_id, parent_window, kind).await {
            PortalAnswer::DynamicLauncher { name } => (
                0,
                HashMap::from([
                    (
                        "name".to_string(),
                        OwnedValue::from(zbus::zvariant::Str::from(name)),
                    ),
                    ("icon".to_string(), icon_v),
                ]),
            ),
            PortalAnswer::Canceled => (1, HashMap::new()),
            // A refusal, or an answer of another kind, which the queue
            // refuses (`accepts`).
            _ => (2, HashMap::new()),
        }
    }

    /// Refused for every application, so each install shows the dialog.
    fn request_install_token(&self, app_id: String, _options: HashMap<String, OwnedValue>) -> u32 {
        debug!(%app_id, "no application installs launchers without asking");
        2
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn supported_launcher_types(&self) -> u32 {
        SUPPORTED_LAUNCHER_TYPES
    }

    #[zbus(property(emits_changed_signal = "const"), name = "version")]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

/// The dialog a call asks for, and whether it is modal (by default it is). A
/// mistyped option reads as absent.
fn asked(
    name: String,
    icon_v: &OwnedValue,
    mut options: HashMap<String, OwnedValue>,
) -> (PortalKind, bool) {
    let mut flag = |key: &str, default: bool| {
        options
            .remove(key)
            .and_then(|value| bool::try_from(value).ok())
            .unwrap_or(default)
    };
    let modal = flag("modal", true);
    let editable_name = flag("editable_name", true);
    let launcher_type = match options
        .remove("launcher_type")
        .and_then(|value| u32::try_from(value).ok())
    {
        Some(WEBAPP) => LauncherType::Webapp,
        _ => LauncherType::Application,
    };
    let target = options
        .remove("target")
        .and_then(|value| String::try_from(value).ok());
    let kind = PortalKind::DynamicLauncher(LauncherDialog {
        name,
        icon: icon_bytes(icon_v).and_then(|bytes| icon_url(&bytes)),
        launcher_type,
        target,
        editable_name,
    });
    (kind, modal)
}

/// The bytes of a `GBytesIcon` as `g_icon_serialize()` writes it:
/// `("bytes", <ay>)`.
fn icon_bytes(icon_v: &OwnedValue) -> Option<Vec<u8>> {
    let Value::Structure(icon) = &**icon_v else {
        return None;
    };
    match icon.fields() {
        [Value::Str(kind), Value::Value(data)] if kind.as_str() == "bytes" => {
            Vec::<u8>::try_from(data.try_clone().ok()?).ok()
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    use std::thread;
    use std::time::Duration;

    use domicile_protocol::PortalRequest;
    use zbus::zvariant::ObjectPath;

    use crate::portals::socket_pair::connected;

    const PATH: &str = "/org/freedesktop/portal/desktop";
    const INTERFACE: &str = "org.freedesktop.impl.portal.DynamicLauncher";
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nicon";

    struct Served {
        client: zbus::blocking::Connection,
        queue: Arc<Queue>,
        published: Receiver<Vec<PortalRequest>>,
        _server: zbus::blocking::Connection,
    }

    fn served() -> Served {
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
        let (server, client) = connected(move |builder| {
            builder
                .serve_at(PATH, DynamicLauncher { queue: serving })
                .expect("served")
        });
        Served {
            client,
            queue,
            published,
            _server: server,
        }
    }

    fn icon() -> OwnedValue {
        OwnedValue::try_from(Value::from(("bytes", Value::from(PNG.to_vec())))).expect("ownable")
    }

    /// Call `PrepareInstall` from another thread.
    fn prepare_install(
        client: &zbus::blocking::Connection,
    ) -> thread::JoinHandle<(u32, HashMap<String, OwnedValue>)> {
        let client = client.clone();
        thread::spawn(move || {
            let options = HashMap::from([
                ("launcher_type".to_string(), OwnedValue::from(WEBAPP)),
                (
                    "target".to_string(),
                    OwnedValue::try_from(Value::from("https://mail.example.com")).expect("ownable"),
                ),
            ]);
            client
                .call_method(
                    None::<&str>,
                    PATH,
                    Some(INTERFACE),
                    "PrepareInstall",
                    &(
                        ObjectPath::try_from("/org/freedesktop/portal/desktop/request/1_7/l")
                            .expect("a path"),
                        "org.example.Browser",
                        "",
                        "Mail",
                        Value::from(icon()),
                        options,
                    ),
                )
                .expect("PrepareInstall answered")
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
    fn an_install_waits_for_the_name_the_user_chose() {
        let served = served();
        let asking = prepare_install(&served.client);

        assert_eq!(
            next(&served.published)
                .into_iter()
                .map(|request| request.kind)
                .collect::<Vec<_>>(),
            [PortalKind::DynamicLauncher(LauncherDialog {
                name: "Mail".into(),
                icon: icon_url(PNG),
                launcher_type: LauncherType::Webapp,
                target: Some("https://mail.example.com".into()),
                editable_name: true,
            })]
        );
        served.queue.answer(
            1,
            PortalAnswer::DynamicLauncher {
                name: "Work mail".into(),
            },
        );

        let (response, results) = asking.join().expect("the call returned");
        assert_eq!(response, 0);
        assert_eq!(
            results
                .get("name")
                .map(|name| String::try_from(name.try_clone().expect("cloned"))),
            Some(Ok("Work mail".to_string()))
        );
        assert_eq!(
            results.get("icon").and_then(icon_bytes),
            Some(PNG.to_vec()),
            "the icon goes back as it came"
        );
    }

    #[test]
    fn a_dismissed_install_installs_nothing() {
        let served = served();
        let asking = prepare_install(&served.client);
        next(&served.published);
        served.queue.answer(1, PortalAnswer::Canceled);

        let (response, results) = asking.join().expect("the call returned");
        assert_eq!(response, 1);
        assert!(results.is_empty());
    }

    #[test]
    fn no_application_installs_without_asking() {
        let served = served();

        let response: u32 = served
            .client
            .call_method(
                None::<&str>,
                PATH,
                Some(INTERFACE),
                "RequestInstallToken",
                &("org.example.Browser", HashMap::<String, OwnedValue>::new()),
            )
            .expect("RequestInstallToken answered")
            .body()
            .deserialize()
            .expect("a response");

        assert_eq!(response, 2);
    }

    #[test]
    fn applications_and_web_apps_are_supported() {
        let served = served();
        let property = |name: &str| -> u32 {
            let value: OwnedValue = served
                .client
                .call_method(
                    None::<&str>,
                    PATH,
                    Some("org.freedesktop.DBus.Properties"),
                    "Get",
                    &(INTERFACE, name),
                )
                .expect("Get answered")
                .body()
                .deserialize()
                .expect("a value");
            u32::try_from(value).expect("a u")
        };

        assert_eq!(property("SupportedLauncherTypes"), 3);
        assert_eq!(property("version"), INTERFACE_VERSION);
    }

    #[test]
    fn an_icon_that_is_no_picture_is_left_out() {
        let (kind, modal) = asked(
            "Mail".into(),
            &OwnedValue::try_from(Value::from(("themed", Value::from(vec!["mail"]))))
                .expect("ownable"),
            HashMap::from([
                ("modal".to_string(), OwnedValue::from(false)),
                ("editable_name".to_string(), OwnedValue::from(false)),
            ]),
        );

        assert!(!modal);
        assert_eq!(
            kind,
            PortalKind::DynamicLauncher(LauncherDialog {
                name: "Mail".into(),
                icon: None,
                launcher_type: LauncherType::Application,
                target: None,
                editable_name: false,
            })
        );
    }
}
