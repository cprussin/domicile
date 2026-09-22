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

use crate::handshake::Expected;

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
    /// Whether a page is going to dial [`chrome_socket`](Self::chrome_socket).
    ///
    /// [`Expected::APage`] unless `--expect-a-page no` says otherwise, because
    /// a compositor is nearly always started to draw a desktop and a control
    /// socket nothing reaches is the failure
    /// [`crate::handshake`] exists to name. The engine spike's harnesses are
    /// the exception and say so; [`Expected`] is where the reason is.
    pub expect_a_page: Expected,
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

    #[error("{flag} takes yes or no, and was given {value}")]
    NotYesOrNo { flag: &'static str, value: String },
}

/// Read a compositor command line, or say why it cannot be run.
pub fn arguments(args: impl IntoIterator<Item = OsString>) -> Result<Arguments, ArgumentError> {
    let mut chrome_socket = None;
    let mut session = None;
    let mut config = None;
    let mut engine_socket = None;
    let mut expect_a_page = None;

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
        //
        // `OsString` rather than `PathBuf`, because not every value is a path
        // any more: `--expect-a-page` takes a word. Which flags become paths
        // is decided once, below, where the whole command line is read back.
        let slot = match flag.as_str() {
            CHROME_SOCKET => &mut chrome_socket,
            SESSION => &mut session,
            CONFIG => &mut config,
            ENGINE_SOCKET => &mut engine_socket,
            EXPECT_A_PAGE => &mut expect_a_page,
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
        *slot = Some(value);
    }

    Ok(Arguments {
        chrome_socket: chrome_socket
            .map(PathBuf::from)
            .ok_or(ArgumentError::Missing {
                flag: CHROME_SOCKET,
            })?,
        session: session
            .map(PathBuf::from)
            .ok_or(ArgumentError::Missing { flag: SESSION })?,
        config: config.map(PathBuf::from),
        engine_socket: engine_socket.map(PathBuf::from),
        expect_a_page: match expect_a_page {
            Some(value) => expected(&value)?,
            None => Expected::APage,
        },
    })
}

const CHROME_SOCKET: &str = "--chrome-socket";
const SESSION: &str = "--session";
const CONFIG: &str = "--config";
const ENGINE_SOCKET: &str = "--engine-socket";
const EXPECT_A_PAGE: &str = "--expect-a-page";

/// Which of the two words `--expect-a-page` was given.
///
/// Not "anything that is not `no` means yes". The thing this flag can do is
/// turn a watchdog off, so a value nobody here understands is refused for the
/// reason an unknown flag is: a request that silently did not happen is worse
/// than one that failed.
fn expected(value: &OsStr) -> Result<Expected, ArgumentError> {
    match value.as_bytes() {
        b"yes" => Ok(Expected::APage),
        b"no" => Ok(Expected::NoPage),
        _ => Err(ArgumentError::NotYesOrNo {
            flag: EXPECT_A_PAGE,
            value: value.to_string_lossy().into_owned(),
        }),
    }
}

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
