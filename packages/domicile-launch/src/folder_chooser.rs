//! Asks the desktop's FileChooser portal for a folder: the Settings app's
//! picker for an unpacked extension. The shell draws the dialog
//! (`docs/PORTALS.md`).
//!
//! A page cannot learn the absolute path of a folder picked with
//! `<input type="file">`, so `domicile-app-host` asks the portal instead.

use std::collections::HashMap;
use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt as _;
use std::path::PathBuf;

use domicile_host::uri::percent_decoded;
use zbus::export::ordered_stream::OrderedStreamExt;
use zbus::message::Type;
use zbus::{OwnedObjectPath, OwnedVariant, Variant};

const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const FILE_CHOOSER: &str = "org.freedesktop.portal.FileChooser";
const REQUEST: &str = "org.freedesktop.portal.Request";

/// The `Response` code for a dialog the user dismissed.
const CANCELED: u32 = 1;

/// Shows the portal's folder picker titled `title` and waits for it.
///
/// Returns the folder, or `None` if the user canceled.
pub fn choose_folder(bus: &zbus::Connection, title: &str) -> Result<Option<PathBuf>, String> {
    // Listening before asking: the portal may answer before `OpenFile`
    // returns the request's path.
    let rule = zbus::MatchRule::builder()
        .msg_type(Type::Signal)
        .interface(REQUEST)
        .member("Response")
        .build()
        .map_err(|why| format!("cannot listen for the portal's answer: {why}"))?;
    let mut messages = zbus::block_on(zbus::MessageStream::for_match_rule(rule, bus, None))
        .map_err(|why| format!("cannot listen for the portal's answer: {why}"))?;
    let options = HashMap::from([
        ("directory", Variant::from(true)),
        ("modal", Variant::from(true)),
        ("accept_label", Variant::from("Load")),
        ("handle_token", Variant::from("domicile_settings")),
    ]);
    let request: OwnedObjectPath = zbus::block_on(bus.call_method(
        Some(PORTAL),
        PORTAL_PATH,
        Some(FILE_CHOOSER),
        "OpenFile",
        &("", title, options),
    ))
    .and_then(|reply| reply.body().deserialize())
    .map_err(|why| format!("the file chooser portal did not open: {why}"))?;
    for message in std::iter::from_fn(|| zbus::block_on(messages.next())) {
        let message = message.map_err(|why| format!("lost the portal's answer: {why}"))?;
        if message.header().path().map(|path| path.as_str()) == Some(request.as_str()) {
            let (response, results): (u32, HashMap<String, OwnedVariant>) = message
                .body()
                .deserialize()
                .map_err(|why| format!("the portal's answer is not a response: {why}"))?;
            return match response {
                0 => first_folder(&results).map(Some),
                CANCELED => Ok(None),
                other => Err(format!("the file chooser failed with response {other}")),
            };
        }
    }
    Err("the session bus closed before the file chooser answered".to_string())
}

/// The path of the first `file://` URI in a response's `uris`.
fn first_folder(results: &HashMap<String, OwnedVariant>) -> Result<PathBuf, String> {
    let uris: Vec<String> = results
        .get("uris")
        .ok_or("the file chooser answered without a folder")?
        .try_clone()
        .map_err(|why| why.to_string())?
        .try_into()
        .map_err(|why: zbus::Error| format!("the file chooser's uris: {why}"))?;
    let uri = uris
        .first()
        .ok_or("the file chooser answered without a folder")?;
    uri.strip_prefix("file://")
        .filter(|path| path.starts_with('/'))
        .map(|path| PathBuf::from(OsString::from_vec(percent_decoded(path))))
        .ok_or_else(|| format!("{uri} is not a local folder"))
}
