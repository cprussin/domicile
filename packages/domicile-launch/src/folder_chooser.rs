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

use zbus::message::Type;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const FILE_CHOOSER: &str = "org.freedesktop.portal.FileChooser";
const REQUEST: &str = "org.freedesktop.portal.Request";

/// The `Response` code for a dialog the user dismissed.
const CANCELED: u32 = 1;

/// Shows the portal's folder picker titled `title` and waits for it.
///
/// Returns the folder, or `None` if the user canceled.
pub fn choose_folder(
    bus: &zbus::blocking::Connection,
    title: &str,
) -> Result<Option<PathBuf>, String> {
    // Listening before asking: the portal may answer before `OpenFile`
    // returns the request's path.
    let rule = zbus::MatchRule::builder()
        .msg_type(Type::Signal)
        .interface(REQUEST)
        .and_then(|rule| rule.member("Response"))
        .map(|rule| rule.build())
        .map_err(|why| format!("cannot listen for the portal's answer: {why}"))?;
    let messages = zbus::blocking::MessageIterator::for_match_rule(rule, bus, None)
        .map_err(|why| format!("cannot listen for the portal's answer: {why}"))?;
    let options = HashMap::from([
        ("directory", Value::from(true)),
        ("modal", Value::from(true)),
        ("accept_label", Value::from("Load")),
        ("handle_token", Value::from("domicile_settings")),
    ]);
    let request: OwnedObjectPath = bus
        .call_method(
            Some(PORTAL),
            PORTAL_PATH,
            Some(FILE_CHOOSER),
            "OpenFile",
            &("", title, options),
        )
        .and_then(|reply| reply.body().deserialize())
        .map_err(|why| format!("the file chooser portal did not open: {why}"))?;
    for message in messages {
        let message = message.map_err(|why| format!("lost the portal's answer: {why}"))?;
        if message.header().path().map(|path| path.as_str()) == Some(request.as_str()) {
            let (response, results): (u32, HashMap<String, OwnedValue>) = message
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
fn first_folder(results: &HashMap<String, OwnedValue>) -> Result<PathBuf, String> {
    let uris: Vec<String> = results
        .get("uris")
        .ok_or("the file chooser answered without a folder")?
        .try_clone()
        .map_err(|why| why.to_string())?
        .try_into()
        .map_err(|why: zbus::zvariant::Error| format!("the file chooser's uris: {why}"))?;
    let uri = uris
        .first()
        .ok_or("the file chooser answered without a folder")?;
    uri.strip_prefix("file://")
        .filter(|path| path.starts_with('/'))
        .map(unescaped)
        .ok_or_else(|| format!("{uri} is not a local folder"))
}

/// `path` with each `%XX` replaced by its byte.
fn unescaped(path: &str) -> PathBuf {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let byte = match (bytes[at], bytes.get(at + 1..at + 3)) {
            (b'%', Some(hex)) => std::str::from_utf8(hex)
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok()),
            _ => None,
        };
        match byte {
            Some(byte) => {
                out.push(byte);
                at += 3;
            }
            None => {
                out.push(bytes[at]);
                at += 1;
            }
        }
    }
    PathBuf::from(OsString::from_vec(out))
}
