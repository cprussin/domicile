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
    /// Open a window and draw client surfaces into it, rather than sending
    /// their pixels to the chrome.
    pub present: bool,

    /// Advertise Chromium's `surface_augmenter`, which this compositor does
    /// not implement.
    ///
    /// An experiment and nothing else, which is why the flag says so and why
    /// it defaults off. Every request through the augmenter is logged and none
    /// is honoured, so a desktop run with this on would be one where the
    /// engine has been told a lie about what its windows can be told to do.
    ///
    /// What it is for: measured without it, the engine delegates a whole page
    /// as one quad however many composited layers the page has. `exo`, the
    /// ChromeOS compositor, is the one server known to make it send a quad per
    /// layer, and this protocol is the last difference between that server and
    /// this one. Whether the engine gates per-quad delegation on finding an
    /// augmenter cannot be answered from outside it, so it is answered by
    /// advertising one and reading what the engine then asks for.
    pub experiment_augmenter: bool,
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

    #[error("{flag} takes no value")]
    UnwantedValue { flag: String },

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
    let mut present = false;
    let mut experiment_augmenter = false;

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
        let slot = match flag.as_str() {
            EXPERIMENT_AUGMENTER => {
                if joined.is_some() {
                    return Err(ArgumentError::UnwantedValue { flag });
                }
                experiment_augmenter = true;
                continue;
            }
            PRESENT => {
                // `--present=false` used to turn presenting *on*: the value
                // went nowhere and the flag's presence was the whole answer.
                // A shell with a boolean in hand writes exactly that.
                if joined.is_some() {
                    return Err(ArgumentError::UnwantedValue { flag });
                }
                present = true;
                continue;
            }
            CHROME_SOCKET => &mut chrome_socket,
            SESSION => &mut session,
            CONFIG => &mut config,
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
        present,
        experiment_augmenter,
    })
}

const CHROME_SOCKET: &str = "--chrome-socket";
const SESSION: &str = "--session";
const CONFIG: &str = "--config";
const PRESENT: &str = "--present";
const EXPERIMENT_AUGMENTER: &str = "--experiment-augmenter";

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
