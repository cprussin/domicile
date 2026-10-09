//! The client's command line.
//!
//! Parsing is strict: unknown, repeated and empty arguments are errors, so a
//! check never gets a different window than it asked for.
//!
//! The initial window size is a constant in `window.rs`; no check needs to set
//! it.

use std::ffi::OsString;

/// What to open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Arguments {
    /// The toplevel's title, which checks use to tell windows apart.
    pub title: String,
    /// Whether to print the protocol messages this client receives.
    pub trace: bool,
    /// Whether to resize to the configured size instead of keeping its own.
    ///
    /// Off by default because most checks rely on a fixed window size. On, the
    /// client behaves like the chrome, which the compositor sizes to the
    /// desktop (see `e2e-chrome-fills-the-desktop.sh`).
    pub follow_configure: bool,

    /// Whether the window is half-transparent.
    ///
    /// Lets a check tell the client's own pixels apart from something painted
    /// over the window.
    pub translucent: bool,

    /// When to request focus with `xdg_activation_v1`, if at all.
    pub ask_for_focus: Option<AskForFocus>,

    /// Text to offer on the clipboard.
    ///
    /// A Wayland client serves every paste of its own selection, so clipboard
    /// checks need a real client to hold the data.
    pub copy: Option<String>,

    /// Text to offer on the primary (middle-click) selection.
    ///
    /// Separate from [`copy`](Self::copy) so checks can catch a compositor that
    /// mixes up the two selections.
    pub copy_primary: Option<String>,

    /// When to take a `zwp_idle_inhibit_manager_v1` inhibitor on its surface,
    /// if at all.
    pub hold_the_screens_on: Option<HoldTheScreensOn>,

    /// Whether to stay connected after its window is closed.
    ///
    /// On, the client destroys the `xdg_toplevel` but keeps the connection, so
    /// checks can tell a closed window apart from a client disconnecting.
    pub outlive_its_window: bool,

    /// Whether to read and trace every offer on either selection.
    ///
    /// Selections are only offered to the focused client, so this only works
    /// once the window has keyboard focus.
    pub paste: bool,

    /// Whether to open a popup over the window once it is up.
    ///
    /// See [`crate::window::POPUP`] for its placement and color.
    pub popup: bool,

    /// Whether the popup calls `xdg_popup.grab` before its first commit, as a
    /// menu does. Implies `popup`.
    pub popup_grab: bool,

    /// Whether to open a bubble over the window once it is up: a desync
    /// `wl_subsurface`, as Chromium draws an extension popup.
    ///
    /// See [`crate::window::BUBBLE`] for its placement.
    pub bubble: bool,
    /// Size limits for `xdg_toplevel.set_min_size` and `set_max_size`, in
    /// surface pixels. `0` on an axis means no limit.
    pub min_size: Option<(i32, i32)>,
    pub max_size: Option<(i32, i32)>,
}

/// When the client takes its idle inhibitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldTheScreensOn {
    /// After the surface becomes a window, as a video player does.
    OnItsWindow,
    /// Before the surface has a role.
    ///
    /// The protocol allows this. A desktop must not honor it, or a client with
    /// no visible window could keep the screens on.
    BeforeItHasAWindow,
}

/// When the client asks for the keyboard, and with which serial.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskForFocus {
    /// Once its window is up, without a serial.
    OnceMapped,
    /// When the keyboard enters it, with that `enter`'s serial: a request the
    /// user's own focus change backs.
    WhenEntered,
    /// When the keyboard leaves it, with the serial of the `enter` before: a
    /// window taking the keyboard back after the user moved on.
    WhenLeft,
}

/// Why a command line was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArgumentError {
    #[error("{flag} needs a value after it")]
    NeedsValue { flag: String },

    #[error("{flag} was given an empty value")]
    EmptyValue { flag: String },

    #[error("{flag} was given more than once")]
    Repeated { flag: String },

    #[error("{flag} wants WIDTHxHEIGHT, not {value}")]
    NotASize { flag: String, value: String },

    #[error("unknown argument {argument}")]
    Unknown { argument: String },
}

/// Parse the client's command line.
pub fn arguments(args: impl IntoIterator<Item = OsString>) -> Result<Arguments, ArgumentError> {
    let mut title = None;
    let mut trace = None;
    let mut translucent = None;
    let mut follow_configure = None;
    let mut ask_for_focus = None;
    let mut hold_the_screens_on = None;
    let mut outlive_its_window = None;
    let mut copy = None;
    let mut copy_primary = None;
    let mut paste = None;
    let mut popup = None;
    let mut popup_grab = None;
    let mut bubble = None;
    let mut min_size = None;
    let mut max_size = None;

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
            "--translucent" => {
                take(&mut translucent, &flag, true)?;
            }
            "--follow-configure" => {
                take(&mut follow_configure, &flag, true)?;
            }
            "--ask-for-focus" => {
                take(&mut ask_for_focus, &flag, AskForFocus::OnceMapped)?;
            }
            "--ask-for-focus-when-entered" => {
                take(&mut ask_for_focus, &flag, AskForFocus::WhenEntered)?;
            }
            "--ask-for-focus-when-left" => {
                take(&mut ask_for_focus, &flag, AskForFocus::WhenLeft)?;
            }
            "--hold-the-screens-on" => {
                take(
                    &mut hold_the_screens_on,
                    &flag,
                    HoldTheScreensOn::OnItsWindow,
                )?;
            }
            "--hold-the-screens-on-before-it-has-a-window" => {
                take(
                    &mut hold_the_screens_on,
                    &flag,
                    HoldTheScreensOn::BeforeItHasAWindow,
                )?;
            }
            "--outlive-its-window" => {
                take(&mut outlive_its_window, &flag, true)?;
            }
            "--copy" => {
                take(&mut copy, &flag, value(&mut args, &flag)?)?;
            }
            "--copy-primary" => {
                take(&mut copy_primary, &flag, value(&mut args, &flag)?)?;
            }
            "--paste" => {
                take(&mut paste, &flag, true)?;
            }
            "--popup" => {
                take(&mut popup, &flag, true)?;
            }
            "--popup-grab" => {
                take(&mut popup_grab, &flag, true)?;
            }
            "--bubble" => {
                take(&mut bubble, &flag, true)?;
            }
            "--min-size" => {
                take(&mut min_size, &flag, size(&mut args, &flag)?)?;
            }
            "--max-size" => {
                take(&mut max_size, &flag, size(&mut args, &flag)?)?;
            }
            _ => return Err(ArgumentError::Unknown { argument: flag }),
        }
    }

    Ok(Arguments {
        title: title.unwrap_or_else(|| "domicile-test-client".to_string()),
        follow_configure: follow_configure.unwrap_or(false),
        trace: trace.unwrap_or(false),
        translucent: translucent.unwrap_or(false),
        ask_for_focus,
        hold_the_screens_on,
        outlive_its_window: outlive_its_window.unwrap_or(false),
        copy,
        copy_primary,
        paste: paste.unwrap_or(false),
        popup: popup.unwrap_or(false) || popup_grab.unwrap_or(false),
        popup_grab: popup_grab.unwrap_or(false),
        bubble: bubble.unwrap_or(false),
        min_size,
        max_size,
    })
}

/// The value after a flag, rejecting a missing or empty one.
///
/// An empty value usually means the caller passed an unset shell variable.
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

/// The `WIDTHxHEIGHT` after a flag.
fn size(
    args: &mut impl Iterator<Item = OsString>,
    flag: &str,
) -> Result<(i32, i32), ArgumentError> {
    let stated = value(args, flag)?;
    stated
        .split_once('x')
        .and_then(|(width, height)| Some((width.parse().ok()?, height.parse().ok()?)))
        .ok_or_else(|| ArgumentError::NotASize {
            flag: flag.to_string(),
            value: stated.clone(),
        })
}

/// Store a flag's value, rejecting a repeated flag.
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
