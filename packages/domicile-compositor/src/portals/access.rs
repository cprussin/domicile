//! `org.freedesktop.impl.portal.Access`: a yes/no question an application
//! puts to the user, such as whether it may use the camera.

use std::collections::HashMap;
use std::sync::Arc;

use domicile_protocol::{AccessDialog, PortalKind};
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

use super::queue::{ask, Queue};

/// The `Access` backend object.
pub struct Access {
    pub queue: Arc<Queue>,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Access")]
impl Access {
    /// Ask, and answer with the portal's response. No `choices`: the shell's
    /// dialog offers none, so the results are empty.
    #[allow(clippy::too_many_arguments)] // The spec's own signature.
    async fn access_dialog(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        title: String,
        subtitle: String,
        body: String,
        options: HashMap<String, OwnedValue>,
    ) -> (u32, HashMap<String, OwnedValue>) {
        let kind = dialog(title, subtitle, body, options);
        let answer = ask(&self.queue, server, handle, app_id, &parent_window, kind).await;
        (answer.response(), HashMap::new())
    }
}

/// The request a call describes. A label of the wrong type reads as absent.
fn dialog(
    title: String,
    subtitle: String,
    body: String,
    mut options: HashMap<String, OwnedValue>,
) -> PortalKind {
    let mut label = |name: &str| {
        options
            .remove(name)
            .and_then(|value| String::try_from(value).ok())
    };
    PortalKind::Access(AccessDialog {
        title,
        subtitle,
        body,
        grant_label: label("grant_label"),
        deny_label: label("deny_label"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zbus::zvariant::Value;

    fn options(sent: Vec<(&str, Value<'static>)>) -> HashMap<String, OwnedValue> {
        sent.into_iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    OwnedValue::try_from(value).expect("an ownable value"),
                )
            })
            .collect()
    }

    #[test]
    fn the_labels_an_application_offers_are_read() {
        let asked = dialog(
            "Use the camera?".into(),
            "Example wants to see you".into(),
            String::new(),
            options(vec![
                ("grant_label", Value::from("Allow")),
                ("deny_label", Value::from(7u32)),
                ("modal", Value::from(true)),
            ]),
        );

        assert_eq!(
            asked,
            PortalKind::Access(AccessDialog {
                title: "Use the camera?".into(),
                subtitle: "Example wants to see you".into(),
                body: String::new(),
                grant_label: Some("Allow".into()),
                deny_label: None,
            })
        );
    }
}
