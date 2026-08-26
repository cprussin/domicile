//! What the client was told to open.
//!
//! Stated rather than defaulted, for the reason `domicile-launch` gives about
//! the compositor's own command line: a check that meant to open a window
//! called `left` can say so, and one that gets a different window because a
//! default moved has no way to notice.
//!
//! The window's size is not here. Nothing in `scripts/` asks for one — they
//! need *a* window and assert on what the compositor did with it — so the size
//! is a constant in `window.rs`, and the flag comes back with the first check
//! that wants it.

use std::ffi::OsString;

/// What to open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Arguments {
    /// The toplevel's title, which is how a chrome names the window and how a
    /// check tells two of them apart.
    pub title: String,
    /// Whether to report the protocol messages this client sees. Off by
    /// default: a buffer release arrives every frame, and the checks that only
    /// need a window open should not pay a write for each one.
    pub trace: bool,
}

/// A command line the client will not run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArgumentError {
    #[error("{flag} needs a value after it")]
    NeedsValue { flag: String },

    #[error("{flag} was given an empty value")]
    EmptyValue { flag: String },

    #[error("{flag} was given more than once")]
    Repeated { flag: String },

    #[error("unknown argument {argument}")]
    Unknown { argument: String },
}

/// Read a client command line, or say why it cannot be run.
pub fn arguments(args: impl IntoIterator<Item = OsString>) -> Result<Arguments, ArgumentError> {
    let mut title = None;
    let mut trace = None;

    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        let flag = argument.to_string_lossy().into_owned();
        match flag.as_str() {
            "--title" => {
                take(&mut title, &flag, value(&mut args, &flag)?)?;
            }
            "--trace" => {
                take(&mut trace, &flag, true)?;
            }
            _ => return Err(ArgumentError::Unknown { argument: flag }),
        }
    }

    Ok(Arguments {
        title: title.unwrap_or_else(|| "domicile-test-client".to_string()),
        trace: trace.unwrap_or(false),
    })
}

/// The value after a flag, refusing one that is missing or empty.
///
/// Empty is refused rather than taken: `--title ""` is a caller that meant to
/// name a window and passed a variable that was not set, and a window with no
/// name is exactly what a check looking for one by name cannot find.
fn value(args: &mut impl Iterator<Item = OsString>, flag: &str) -> Result<String, ArgumentError> {
    let stated = args
        .next()
        .ok_or_else(|| ArgumentError::NeedsValue {
            flag: flag.to_string(),
        })?
        .to_string_lossy()
        .into_owned();
    if stated.is_empty() {
        Err(ArgumentError::EmptyValue {
            flag: flag.to_string(),
        })
    } else {
        Ok(stated)
    }
}

/// Store a flag's value, refusing a second one.
///
/// A repeated flag is a caller that thinks it said two things and will be
/// obeyed on one of them, which is worse than being told.
fn take<T>(slot: &mut Option<T>, flag: &str, stated: T) -> Result<(), ArgumentError> {
    if slot.is_some() {
        Err(ArgumentError::Repeated {
            flag: flag.to_string(),
        })
    } else {
        *slot = Some(stated);
        Ok(())
    }
}
