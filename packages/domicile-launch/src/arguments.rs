//! The command line a shell starts the compositor with.
//!
//! Every value is stated: nothing is read from the environment and nothing has
//! a default location. The compositor is started by a program now, and a
//! program that meant to say something can say it — while a fallback silently
//! turns a shell's bug into a desktop that comes up wearing settings nobody
//! chose.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::OsStrExt as _;
use std::path::PathBuf;

/// What the compositor was told to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Arguments {
    /// Where the host protocol is served. The shell picks it, so it knows
    /// where to connect without being told back.
    pub chrome_socket: PathBuf,
    /// Where to publish the session once everything is bound.
    pub session: PathBuf,
    /// The compositor's own configuration, written by the shell. `None` runs
    /// the defaults.
    pub config: Option<PathBuf>,
    /// Submit client buffers to the forked engine over this socket, instead of
    /// reading them back and sending pixels to the chrome.
    ///
    /// `None` runs the compositor as it always has. When it is set the engine
    /// is required: `libdomicile_engine.so` not being loadable is a startup
    /// failure that says so, because a compositor that silently shows nothing
    /// is the defect this flag would otherwise introduce. See
    /// `docs/architecture/ENGINE-FORK.md`.
    pub engine_socket: Option<PathBuf>,
}

/// A command line the compositor will not run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArgumentError {
    #[error("{flag} is required")]
    Missing { flag: &'static str },

    #[error("{flag} needs a value after it")]
    NeedsValue { flag: String },

    #[error("{flag} was given an empty value")]
    EmptyValue { flag: String },

    #[error("{flag} was given more than once")]
    Repeated { flag: String },

    #[error("unknown argument {argument}")]
    Unknown { argument: String },
}

/// Read a compositor command line, or say why it cannot be run.
pub fn arguments(args: impl IntoIterator<Item = OsString>) -> Result<Arguments, ArgumentError> {
    let mut chrome_socket = None;
    let mut session = None;
    let mut config = None;
    let mut engine_socket = None;

    let mut args = args.into_iter();
    let mut seen = Vec::new();
    while let Some(argument) = args.next() {
        let (flag, joined) = split(&argument);
        // Before anything is read: a program that wrote a flag twice meant one
        // of them, and nothing here can tell which. Silently taking the last
        // is the same "a request that silently did not happen" that an unknown
        // argument is refused for.
        if seen.contains(&flag) {
            return Err(ArgumentError::Repeated { flag });
        }
        seen.push(flag.clone());
        // EVERY FLAG TAKES A VALUE. `--present` was the one that did not, and
        // it went with the window it opened — so there is no longer a way to
        // write a flag that must *not* be given one, and no `UnwantedValue` to
        // refuse it with.
        let slot = match flag.as_str() {
            CHROME_SOCKET => &mut chrome_socket,
            SESSION => &mut session,
            CONFIG => &mut config,
            ENGINE_SOCKET => &mut engine_socket,
            _ => return Err(ArgumentError::Unknown { argument: flag }),
        };
        let value = match joined {
            Some(value) => value,
            None => args
                .next()
                .ok_or(ArgumentError::NeedsValue { flag: flag.clone() })?,
        };
        if value.is_empty() {
            return Err(ArgumentError::EmptyValue { flag });
        }
        *slot = Some(PathBuf::from(value));
    }

    Ok(Arguments {
        chrome_socket: chrome_socket.ok_or(ArgumentError::Missing {
            flag: CHROME_SOCKET,
        })?,
        session: session.ok_or(ArgumentError::Missing { flag: SESSION })?,
        config,
        engine_socket,
    })
}

const CHROME_SOCKET: &str = "--chrome-socket";
const SESSION: &str = "--session";
const CONFIG: &str = "--config";
const ENGINE_SOCKET: &str = "--engine-socket";

/// One argument, split at the first `=` if it has one.
///
/// The flag half is `String` rather than `OsString`: a flag this compositor
/// knows is ASCII, and one it does not is going into an error message either
/// way.
fn split(argument: &OsStr) -> (String, Option<OsString>) {
    let bytes = argument.as_bytes();
    match bytes.iter().position(|byte| *byte == b'=') {
        Some(at) => (
            String::from_utf8_lossy(&bytes[..at]).into_owned(),
            Some(OsStr::from_bytes(&bytes[at + 1..]).to_os_string()),
        ),
        None => (argument.to_string_lossy().into_owned(), None),
    }
}
