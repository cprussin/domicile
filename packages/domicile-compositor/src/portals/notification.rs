//! `org.freedesktop.impl.portal.Notification` (version 2): notifications from
//! sandboxed and portal-using applications.
//!
//! They go straight into the `org.freedesktop.Notifications` history
//! ([`crate::notifications`]), so the shell's drawer shows them with the rest.
//! A press on one comes back as `ActionInvoked` with its target and an
//! `xdg-activation` token.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use domicile_host::notifications::{Icon, LARGEST_FILE};
use domicile_host::portal_notifications::{Action, Button, Invoked, PortalNotification, Priority};
use zbus::object_server::SignalEmitter;
use zbus::{Fd, OwnedVariant, Variant};

use crate::notifications::NotificationServer;

/// The `org.freedesktop.impl.portal.Notification` version implemented.
const INTERFACE_VERSION: u32 = 2;

/// The `Notification` backend object.
pub struct Notification {
    pub notifications: NotificationServer,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Notification")]
impl Notification {
    fn add_notification(
        &self,
        app_id: String,
        id: String,
        notification: HashMap<String, OwnedVariant>,
    ) {
        self.notifications
            .add_from_portal(app_id, id, parsed(notification));
    }

    fn remove_notification(&self, app_id: &str, id: &str) {
        self.notifications.remove_from_portal(app_id, id);
    }

    #[zbus(signal)]
    async fn action_invoked(
        emitter: &SignalEmitter<'_>,
        app_id: &str,
        id: &str,
        action: &str,
        parameter: Vec<Variant<'_>>,
    ) -> zbus::Result<()>;

    /// No categories or button purposes: the shell draws every notification
    /// the same.
    #[zbus(property(emits_changed_signal = "const"))]
    fn supported_options(&self) -> HashMap<String, OwnedVariant> {
        HashMap::new()
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

/// Emit `ActionInvoked`. The parameter is the action's target, if it has one,
/// then the platform data: `token` as its `activation-token`, which the
/// application raises its window with.
pub fn invoked(
    served: &zbus::object_server::InterfaceRef<Notification>,
    invoked: Invoked<OwnedVariant>,
    token: String,
) {
    let platform_data = HashMap::from([("activation-token", Variant::from(token))]);
    let said = zbus::block_on(Notification::action_invoked(
        served.signal_emitter(),
        &invoked.app_id,
        &invoked.id,
        &invoked.action,
        invoked
            .target
            .into_iter()
            .map(Variant::from)
            .chain([Variant::from(platform_data)])
            .collect(),
    ));
    if let Err(why) = said {
        tracing::error!(%why, id = invoked.id, "a portal notification's action could not be said");
    }
}

/// An `AddNotification`'s notification. A missing or mistyped field reads as
/// absent; fields the shell does not use are dropped.
fn parsed(mut sent: HashMap<String, OwnedVariant>) -> PortalNotification<OwnedVariant> {
    let mut text = |name: &str| {
        sent.remove(name)
            .and_then(|value| String::try_from(value).ok())
    };
    let title = text("title").unwrap_or_default();
    let body = text("body").unwrap_or_default();
    let priority = match text("priority").as_deref() {
        Some("low") => Priority::Low,
        Some("high") => Priority::High,
        Some("urgent") => Priority::Urgent,
        _ => Priority::Normal,
    };
    let default_action = text("default-action").map(|name| Action {
        name,
        target: sent.remove("default-action-target"),
    });
    let buttons = sent
        .remove("buttons")
        .and_then(|value| Vec::<HashMap<String, OwnedVariant>>::try_from(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(button)
        .collect();
    let display_hint = sent
        .remove("display-hint")
        .and_then(|value| Vec::<String>::try_from(value).ok())
        .unwrap_or_default();
    let icon = sent.remove("icon").and_then(icon);
    PortalNotification {
        title,
        body,
        icon,
        priority,
        default_action,
        buttons,
        display_hint,
    }
}

/// A button, or `None` without a label and an action.
fn button(mut sent: HashMap<String, OwnedVariant>) -> Option<Button<OwnedVariant>> {
    let mut text = |name: &str| {
        sent.remove(name)
            .and_then(|value| String::try_from(value).ok())
    };
    let (label, name) = (text("label")?, text("action")?);
    Some(Button {
        label,
        action: Action {
            name,
            target: sent.remove("target"),
        },
    })
}

/// A serialized icon: `("themed", as)`, `("bytes", ay)` or
/// `("file-descriptor", h)`.
fn icon(sent: OwnedVariant) -> Option<Icon> {
    let Variant::Structure(sent) = Variant::from(sent) else {
        return None;
    };
    let [Variant::Str(kind), Variant::Variant(value)] =
        <[Variant; 2]>::try_from(sent.into_fields()).ok()?
    else {
        return None;
    };
    match kind.as_str() {
        "themed" => Vec::<String>::try_from(*value).ok().map(Icon::Themed),
        "bytes" => Vec::<u8>::try_from(*value).ok().map(Icon::Bytes),
        "file-descriptor" => {
            let fd = std::os::fd::OwnedFd::try_from(Fd::try_from(*value).ok()?).ok()?;
            let mut bytes = Vec::new();
            // One byte past the limit, so the history can tell it is too big.
            File::from(fd)
                .take(LARGEST_FILE + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            Some(Icon::Bytes(bytes))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::fixture::options as sent;
    use super::*;
    use std::io::{Seek, Write};

    fn button_sent(
        label: &str,
        action: &str,
        target: Option<Variant<'static>>,
    ) -> Variant<'static> {
        let mut fields = vec![
            ("label", Variant::from(label.to_string())),
            ("action", Variant::from(action.to_string())),
        ];
        fields.extend(target.map(|target| ("target", target)));
        Variant::from(sent(fields))
    }

    #[test]
    fn what_a_notification_says_is_read() {
        let read = parsed(sent(vec![
            ("title", Variant::from("Update")),
            ("body", Variant::from("Ready to install")),
            ("priority", Variant::from("urgent")),
            ("default-action", Variant::from("app.open")),
            ("default-action-target", Variant::from(7u32)),
            (
                "buttons",
                Variant::from(vec![
                    button_sent("Restart", "app.restart", Some(Variant::from("now"))),
                    button_sent("Later", "app.later", None),
                    // No action: dropped.
                    Variant::from(sent(vec![("label", Variant::from("Broken"))])),
                ]),
            ),
            ("display-hint", Variant::from(vec!["persistent"])),
            (
                "icon",
                Variant::from(("themed", Variant::from(vec!["software-update"]))),
            ),
            ("category", Variant::from("im.received")),
        ]));

        assert_eq!(
            (read.title.as_str(), read.body.as_str(), read.priority),
            ("Update", "Ready to install", Priority::Urgent)
        );
        let default_action = read.default_action.expect("a default action");
        assert_eq!(default_action.name, "app.open");
        assert_eq!(default_action.target.map(u32::try_from), Some(Ok(7)));
        assert_eq!(
            read.buttons
                .iter()
                .map(|button| (button.label.as_str(), button.action.name.as_str()))
                .collect::<Vec<_>>(),
            [("Restart", "app.restart"), ("Later", "app.later")]
        );
        assert_eq!(read.display_hint, ["persistent"]);
        assert_eq!(
            read.icon,
            Some(Icon::Themed(vec!["software-update".into()]))
        );
    }

    #[test]
    fn a_notification_of_the_wrong_types_is_mostly_absent() {
        let read = parsed(sent(vec![
            ("title", Variant::from(3u32)),
            ("priority", Variant::from("whenever")),
            ("buttons", Variant::from("none")),
            ("icon", Variant::from(("hologram", Variant::from("?")))),
        ]));

        assert_eq!(
            read,
            PortalNotification {
                title: String::new(),
                body: String::new(),
                icon: None,
                priority: Priority::Normal,
                default_action: None,
                buttons: Vec::new(),
                display_hint: Vec::new(),
            }
        );
    }

    #[test]
    fn an_icon_is_read_from_its_bytes_or_its_file() {
        let mut file = tempfile::tempfile().expect("a file");
        file.write_all(b"\x89PNG").expect("written");
        file.rewind().expect("rewound");
        let fd = std::os::fd::OwnedFd::from(file);

        let bytes = icon(
            OwnedVariant::try_from(Variant::from(("bytes", Variant::from(b"\x89PNG".to_vec()))))
                .expect("ownable"),
        );
        let from_file = icon(
            OwnedVariant::try_from(Variant::from((
                "file-descriptor",
                Variant::from(Fd::from(fd)),
            )))
            .expect("ownable"),
        );

        assert_eq!(bytes, Some(Icon::Bytes(b"\x89PNG".to_vec())));
        assert_eq!(from_file, Some(Icon::Bytes(b"\x89PNG".to_vec())));
    }
}
