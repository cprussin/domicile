//! `org.freedesktop.impl.portal.Email`: a new message in the user's mail
//! client, filled in by the application. No dialog: the mail client is where
//! the user reviews it.

use std::collections::HashMap;

use zbus::{OwnedObjectPath, OwnedVariant};

use domicile_host::uri::{percent_encoded, ADDRESS};

/// Opens a `mailto:` URL, asked for by the application with this desktop
/// file id, with the desk's mail client. `Err` names why none opened.
pub type Open = Box<dyn Fn(&str, &str) -> Result<(), String> + Send + Sync>;

/// The `Email` backend object.
pub struct Email {
    pub open: Open,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Email")]
impl Email {
    /// Open the mail client on the message `options` describes. Answers `0`
    /// once it is started, `2` when there is none.
    fn compose_email(
        &self,
        handle: OwnedObjectPath,
        app_id: String,
        _parent_window: String,
        options: HashMap<String, OwnedVariant>,
    ) -> (u32, HashMap<String, OwnedVariant>) {
        let response = match (self.open)(&mailto(options), &app_id) {
            Ok(()) => 0,
            Err(why) => {
                tracing::error!(%why, %handle, %app_id, "an application's email was not opened");
                2
            }
        };
        (response, HashMap::new())
    }
}

/// The `mailto:` URL for a `ComposeEmail` call's `options`.
///
/// Attachments, which the frontend hands over as paths, become `attach=`.
/// Evolution and Geary read it; Thunderbird ignores it. An option of the wrong
/// type reads as absent.
fn mailto(mut options: HashMap<String, OwnedVariant>) -> String {
    let mut text = |name: &str| {
        options
            .remove(name)
            .and_then(|value| String::try_from(value).ok())
    };
    let address = text("address");
    let subject = text("subject");
    let body = text("body");
    let mut list = |name: &str| -> Vec<String> {
        options
            .remove(name)
            .and_then(|value| Vec::<String>::try_from(value).ok())
            .unwrap_or_default()
    };
    let to: Vec<String> = address.into_iter().chain(list("addresses")).collect();
    let fields: Vec<String> = list("cc")
        .into_iter()
        .map(|cc| ("cc", cc))
        .chain(list("bcc").into_iter().map(|bcc| ("bcc", bcc)))
        .chain(subject.map(|subject| ("subject", subject)))
        .chain(body.map(|body| ("body", body)))
        .chain(list("attachments").into_iter().map(|path| ("attach", path)))
        .map(|(name, value)| format!("{name}={}", encoded(&value)))
        .collect();
    let to = to
        .iter()
        .map(|address| encoded(address))
        .collect::<Vec<_>>()
        .join(",");
    if fields.is_empty() {
        format!("mailto:{to}")
    } else {
        format!("mailto:{to}?{}", fields.join("&"))
    }
}

/// `text` percent-encoded for a `mailto:` URL, where `@` may stay.
fn encoded(text: &str) -> String {
    percent_encoded(text, ADDRESS)
}

#[cfg(test)]
mod tests {
    use super::super::fixture::options;
    use super::*;
    use zbus::Variant;

    #[test]
    fn every_field_goes_into_the_url_encoded() {
        let url = mailto(options(vec![
            ("address", Variant::from("a@example.com")),
            ("addresses", Variant::from(vec!["b@example.com"])),
            ("cc", Variant::from(vec!["c@example.com"])),
            ("bcc", Variant::from(vec!["d@example.com", "e@example.com"])),
            ("subject", Variant::from("Hi & bye")),
            ("body", Variant::from("Line 1\nLine 2")),
            ("attachments", Variant::from(vec!["/tmp/a b.pdf"])),
        ]));

        assert_eq!(
            url,
            "mailto:a@example.com,b@example.com\
             ?cc=c@example.com&bcc=d@example.com&bcc=e@example.com\
             &subject=Hi%20%26%20bye&body=Line%201%0ALine%202\
             &attach=%2Ftmp%2Fa%20b.pdf"
        );
    }

    #[test]
    fn a_message_with_only_a_recipient_has_no_query() {
        let url = mailto(options(vec![
            ("address", Variant::from("a@example.com")),
            ("subject", Variant::from(7u32)),
        ]));

        assert_eq!(url, "mailto:a@example.com");
    }
}
