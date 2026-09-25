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
    /// Whether to take the size the compositor configures rather than keeping
    /// the one this client asked for.
    ///
    /// Off by default, and that default is the older behavior on purpose:
    /// almost every check states a size and wants *that* size, so a client
    /// that quietly grew to whatever a configure said would make those checks
    /// about the compositor's arithmetic instead of about their own subject.
    ///
    /// On, this client is the chrome. A chrome is the one Wayland client of
    /// Domicile's whose size is not its own to choose — the compositor sizes
    /// it to the desktop, so a chrome that ignored a configure is a page in the
    /// corner of the screen. `e2e-chrome-fills-the-desktop.sh` is that claim,
    /// and this is what it puts on the chrome's end of it.
    pub follow_configure: bool,

    /// Whether the window is see-through rather than opaque.
    ///
    /// Off by default. `e2e-window-shows-through.sh` was its only caller and
    /// went with the copy path; the flag is kept because a translucent client
    /// is still the one thing that shows what is behind a window.
    /// That check reads what the chrome painted where the window is, and a
    /// headless compositor copies every window into the page rather than
    /// drawing it itself — so what is legitimately there is the client's own
    /// pixels. With an opaque client those are indistinguishable from a
    /// background painted over the window; a half-opaque one makes *fully*
    /// opaque mean one thing only.
    pub translucent: bool,

    /// Whether to ask for the keyboard once the window is up.
    ///
    /// Off by default: a client that asked on every run would make every check
    /// about focus. On, it binds `xdg_activation_v1` and activates its own
    /// surface — the request a Domicile shell is free to refuse, and the only
    /// way to produce one from a real client.
    pub ask_for_focus: bool,

    /// What to put on the clipboard, or nothing to leave it alone.
    ///
    /// **A clipboard check needs a client to hold the bytes.** A Wayland
    /// selection is an offer rather than a copy: the compositor is told which
    /// mime types are on offer and every paste is served by the client that
    /// offered them. So nothing but a real client can put something on a
    /// clipboard, which is what this is for.
    pub copy: Option<String>,

    /// What to put on the middle-click selection, or nothing to leave it
    /// alone.
    ///
    /// Separate from [`copy`](Self::copy) because the two selections are
    /// separate — `zwp_primary_selection_device_manager_v1` is its own global
    /// with its own device — and a client that wrote both from one flag could
    /// not show a desktop that confuses them.
    pub copy_primary: Option<String>,

    /// When to take an idle inhibitor, or `None` to take none.
    ///
    /// `None` by default: almost every check wants a plain window, and a
    /// client that vetoed blanking on every run would make the idle checks
    /// about this flag. Either way round it binds
    /// `zwp_idle_inhibit_manager_v1` and takes an inhibitor on its own
    /// surface — what a video player does, and the only way to produce one
    /// from a real client.
    pub hold_the_screens_on: Option<HoldTheScreensOn>,

    /// Whether this client stays when its window is closed.
    ///
    /// Off by default: a client whose window is closed is a client whose job
    /// is over, and every check but one wants to see it go. On, it destroys
    /// the `xdg_toplevel` and keeps its connection — which is the one way to
    /// tell a *window* going away apart from the *client* that had it going
    /// away, because everything a dead client was holding goes with it.
    pub outlive_its_window: bool,

    /// Whether to read out whatever is offered on either selection.
    ///
    /// Off by default: a selection is only offered to the client that holds
    /// the keyboard, so a client that read one would make every check about
    /// who was focused. On, each offer is read to the end and traced — which
    /// is a real paste, pipe and all, rather than a report that one was
    /// possible.
    pub paste: bool,
}

/// When a client takes the inhibitor it was asked for.
///
/// Two moments rather than a flag and a second flag, because they are two
/// answers to one question and a client takes one inhibitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldTheScreensOn {
    /// Once the surface has a window, which is when a video player asks.
    OnItsWindow,
    /// Before the surface has a window at all.
    ///
    /// The protocol allows it — an inhibitor names a surface, and a surface
    /// need not be anything anybody can see — and it is what a desktop has to
    /// answer for: a client that took one here and never showed the surface
    /// would hold the screens on for as long as it ran.
    BeforeItHasAWindow,
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
    let mut translucent = None;
    let mut follow_configure = None;
    let mut ask_for_focus = None;
    let mut hold_the_screens_on = None;
    let mut outlive_its_window = None;
    let mut copy = None;
    let mut copy_primary = None;
    let mut paste = None;

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
                take(&mut ask_for_focus, &flag, true)?;
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
            _ => return Err(ArgumentError::Unknown { argument: flag }),
        }
    }

    Ok(Arguments {
        title: title.unwrap_or_else(|| "domicile-test-client".to_string()),
        follow_configure: follow_configure.unwrap_or(false),
        trace: trace.unwrap_or(false),
        translucent: translucent.unwrap_or(false),
        ask_for_focus: ask_for_focus.unwrap_or(false),
        hold_the_screens_on,
        outlive_its_window: outlive_its_window.unwrap_or(false),
        copy,
        copy_primary,
        paste: paste.unwrap_or(false),
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
