//! The Settings app's native messaging host: `domicile-settings-host`.
//!
//! The app is an extension, so it cannot read files. Chrome starts this host
//! for it and the two exchange messages over the host's stdin and stdout. The
//! host asks the running desktop which files to edit ([`Request::SettingsFiles`])
//! rather than taking a path from the page, and forwards site permissions and
//! extensions to the engine through the desktop. See `docs/SETTINGS.md`.
//!
//! ```text
//! {"id":1,"type":"read"}
//!   {"id":1,"type":"files","config":{"path":…,"text":…,"writable":true},"evaluated":null,"shell":null}
//! {"id":2,"type":"write","file":"config","text":"{…}"}
//!   {"id":2,"type":"written"}
//! {"id":3,"type":"site_permissions"}
//!   {"id":3,"type":"site_permissions","defaults":{…},"sites":[…]}
//! {"id":4,"type":"set_site_permission","site":{…}}
//!   {"id":4,"type":"stored"}
//! {"id":5,"type":"load_unpacked","directory":"~/src/my-extension"}
//!   {"id":5,"type":"loaded_unpacked","extension":"…"}
//! {"id":6,"type":"uninstall_extension","extension":"…"}
//!   {"id":6,"type":"uninstalled"}
//! {"id":7,"type":"config_extensions"}
//!   {"id":7,"type":"config_extensions","ids":["…"]}
//! any request
//!   {"id":…,"type":"refused","why":"…"}
//! pushed when a file changes on disk
//!   {"type":"changed"}
//! ```

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use domicile_config::Config;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::config_path::is_module;
use crate::control::{Request, Response, SettingsFiles};
use crate::site_permissions::SitePermission;

/// The largest message Chrome accepts from a host.
const MOST_CHROME_TAKES: usize = 1024 * 1024;

/// The largest message the host reads. Chrome sends at most 64 MiB; a page's
/// file is far smaller.
const MOST_THE_HOST_READS: u32 = 16 * 1024 * 1024;

/// What the host reaches outside itself, injected for tests.
pub struct Host<'a> {
    /// Asks the running desktop over its control socket.
    pub ask: &'a dyn Fn(&Request) -> Result<Response, String>,
    pub read: &'a dyn Fn(&Path) -> std::io::Result<String>,
    /// The user's home directory, which a leading `~` names.
    pub home: Option<&'a Path>,
    /// Whether this user may write the file, following links.
    pub writable: &'a dyn Fn(&Path) -> bool,
    /// Replaces the file's contents in place, so a link stays a link.
    pub write: &'a dyn Fn(&Path, &str) -> std::io::Result<()>,
}

/// Answers one message from the app. The reply carries the request's `id`.
pub fn answer(message: &Value, host: &Host) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let replied = serde_json::from_value::<AppRequest>(message.clone())
        .map_err(|why| format!("{message} is not a request this host knows: {why}"))
        .and_then(|request| carry_out(request, host));
    let mut reply = replied.unwrap_or_else(|why| json!({"type": "refused", "why": why}));
    reply["id"] = id;
    reply
}

/// Reads one framed message, or `None` once Chrome closes the input.
pub fn read_message(input: &mut impl Read) -> std::io::Result<Option<Value>> {
    let mut length = [0_u8; 4];
    match input.read_exact(&mut length) {
        Err(why) if why.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        other => other?,
    }
    let length = u32::from_ne_bytes(length);
    if length > MOST_THE_HOST_READS {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("a {length}-byte message is larger than any file the app edits"),
        ));
    }
    let mut body = vec![0_u8; length as usize];
    input.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|why| std::io::Error::new(std::io::ErrorKind::InvalidData, why))
}

/// Writes one framed message and flushes it.
pub fn write_message(output: &mut impl Write, message: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(message).map_err(std::io::Error::other)?;
    if body.len() > MOST_CHROME_TAKES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "a {}-byte reply is larger than Chrome takes from a host",
                body.len()
            ),
        ));
    }
    let length = u32::try_from(body.len()).expect("checked against MOST_CHROME_TAKES");
    output.write_all(&length.to_ne_bytes())?;
    output.write_all(&body)?;
    output.flush()
}

/// A request from the app.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AppRequest {
    Read,
    Write { file: Target, text: String },
    SitePermissions,
    SetSitePermission { site: SitePermission },
    LoadUnpacked { directory: PathBuf },
    // `extension`, since the message's own `id` is the request's.
    UninstallExtension { extension: String },
    ConfigExtensions,
}

/// Which file a write replaces.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Target {
    Config,
    Shell,
}

fn carry_out(request: AppRequest, host: &Host) -> Result<Value, String> {
    match request {
        AppRequest::Read => {
            let files = settings_files(host)?;
            Ok(json!({
                "type": "files",
                "config": file(files.config.as_deref(), host)?,
                "evaluated": files
                    .evaluated
                    .as_deref()
                    .map(|path| read(path, host))
                    .transpose()?,
                "shell": file(files.shell.as_deref(), host)?,
            }))
        }
        AppRequest::Write { file, text } => {
            let files = settings_files(host)?;
            let path = match file {
                Target::Config => files.config,
                Target::Shell => files.shell,
            }
            .ok_or_else(|| match file {
                Target::Config => "this desktop runs without a config file".to_string(),
                Target::Shell => "this desktop's shell is a package, not a file".to_string(),
            })?;
            write(&path, file, &text, host).map(|()| json!({"type": "written"}))
        }
        AppRequest::SitePermissions => match (host.ask)(&Request::SitePermissions)? {
            Response::SitePermissions(settings) => Ok(json!({
                "type": "site_permissions",
                "defaults": settings.defaults,
                "sites": settings.sites,
            })),
            other => Err(refusal_or_surprise(other)),
        },
        AppRequest::SetSitePermission { site } => {
            match (host.ask)(&Request::SetSitePermission { site })? {
                Response::Stored => Ok(json!({"type": "stored"})),
                other => Err(refusal_or_surprise(other)),
            }
        }
        AppRequest::LoadUnpacked { directory } => {
            let directory = absolute(&directory, host.home)?;
            match (host.ask)(&Request::LoadUnpacked { directory })? {
                Response::LoadedUnpacked { id } => {
                    Ok(json!({"type": "loaded_unpacked", "extension": id}))
                }
                other => Err(refusal_or_surprise(other)),
            }
        }
        AppRequest::UninstallExtension { extension } => {
            match (host.ask)(&Request::UninstallExtension { id: extension })? {
                Response::Uninstalled => Ok(json!({"type": "uninstalled"})),
                other => Err(refusal_or_surprise(other)),
            }
        }
        AppRequest::ConfigExtensions => match (host.ask)(&Request::ConfigExtensions)? {
            Response::ConfigExtensions { ids } => {
                Ok(json!({"type": "config_extensions", "ids": ids}))
            }
            other => Err(refusal_or_surprise(other)),
        },
    }
}

/// `directory` with a leading `~` or `~/` expanded, refused unless absolute:
/// the engine does not share the app's idea of a working directory.
fn absolute(directory: &Path, home: Option<&Path>) -> Result<PathBuf, String> {
    let expanded = match (directory.strip_prefix("~"), home) {
        (Ok(rest), Some(home)) => home.join(rest),
        (Ok(_), None) => return Err("HOME is not set, so ~ names no folder".to_string()),
        (Err(_), _) => directory.to_path_buf(),
    };
    match expanded.is_absolute() {
        true => Ok(expanded),
        false => Err(format!(
            "{} is not a folder this host can find: write an absolute path, or one under ~",
            directory.display()
        )),
    }
}

/// Which files the desktop edits, asked fresh each time so a page can never
/// name one.
fn settings_files(host: &Host) -> Result<SettingsFiles, String> {
    match (host.ask)(&Request::SettingsFiles)? {
        Response::SettingsFiles { files } => Ok(files),
        other => Err(refusal_or_surprise(other)),
    }
}

/// A file's path, text and whether it can be written, or null for none.
fn file(path: Option<&Path>, host: &Host) -> Result<Value, String> {
    path.map(|path| {
        Ok(json!({
            "path": path,
            "text": read(path, host)?,
            "writable": (host.writable)(path),
        }))
    })
    .transpose()
    .map(|found| found.unwrap_or(Value::Null))
}

fn read(path: &Path, host: &Host) -> Result<String, String> {
    (host.read)(path).map_err(|why| format!("cannot read {}: {why}", path.display()))
}

/// Writes `text` to `path`, refusing a read-only file and a JSON config the
/// compositor would refuse.
fn write(path: &Path, target: Target, text: &str, host: &Host) -> Result<(), String> {
    if !(host.writable)(path) {
        return Err(format!("{} is read-only", path.display()));
    }
    if matches!(target, Target::Config) && !is_module(path) {
        Config::parse(text).map_err(|why| format!("the compositor would refuse this: {why}"))?;
    }
    (host.write)(path, text).map_err(|why| format!("cannot write {}: {why}", path.display()))
}

/// The desktop's own refusal, or a note that it answered another question.
fn refusal_or_surprise(response: Response) -> String {
    match response {
        Response::Refused { why } => why,
        other => format!("the desktop answered {other:?}, which was not asked"),
    }
}

/// The directories to watch for edits to `files`: each file's own.
pub fn watched(files: &SettingsFiles) -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> = [files.config.as_deref(), files.shell.as_deref()]
        .into_iter()
        .flatten()
        .filter_map(|file| file.parent().map(Path::to_path_buf))
        .collect();
    directories.sort();
    directories.dedup();
    directories
}
