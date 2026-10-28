//! Decides which `xdg-activation` requests reach the shell, and mints the
//! tokens the compositor hands out.
//!
//! A request carries the serial of the input or focus event its token was made
//! for. A window that asks with a serial older than the keyboard's last
//! handover is asking on its own, not for the user, so it is dropped. A real
//! one (a click in one app that opens another) still reaches the shell, which
//! grants it.
//!
//! The compositor mints a token for what the user does in the chrome: pressing
//! a notification (`ActivationToken`) and launching an app
//! (`XDG_ACTIVATION_TOKEN`). The app raises its window with it, as a singleton
//! app does when launched again. Such a token carries no serial: the chrome
//! may move the keyboard after minting it, as closing the notification drawer
//! does. It is good for [`MINTED_FOR`], and only the newest is kept, so an
//! app answering late cannot take the keyboard from a later choice.
//!
//! Some apps ignore `ActivationToken` and ask with a token of their own, made
//! for their last input (Electron before 42, so Slack). A press's token also
//! lets the process that sent the notification raise its window that way,
//! once, while the token is good.

use std::time::Duration;

use smithay::utils::Serial;
use smithay::wayland::xdg_activation::{XdgActivationState, XdgActivationTokenData};

/// How long a token the compositor minted stays good: time for a running app
/// to answer, not for one to start. A new window takes the keyboard anyway.
pub const MINTED_FOR: Duration = Duration::from_secs(10);

/// Marks a token the compositor minted for the user.
struct Minted {
    /// The process whose notification was pressed, if one was.
    sender: Option<u32>,
}

/// Mint a token for the user's latest press in the chrome, dropping any older
/// one. `sender` is the process whose notification was pressed, if one was.
pub fn mint(state: &mut XdgActivationState, sender: Option<u32>) -> String {
    state.retain_tokens(|_, data| data.user_data.get::<Minted>().is_none());
    state.create_external_token(minted(sender)).0.to_string()
}

/// The data of a token the compositor mints.
fn minted(sender: Option<u32>) -> XdgActivationTokenData {
    let data = XdgActivationTokenData::default();
    data.user_data.insert_if_missing(|| Minted { sender });
    data
}

/// Whether the minted token `data` lets process `pid` raise its window with
/// a token of its own: `pid` sent the notification pressed, and the token is
/// still good.
pub fn invites(data: &XdgActivationTokenData, pid: u32) -> bool {
    data.user_data
        .get::<Minted>()
        .is_some_and(|minted| minted.sender == Some(pid))
        && data.timestamp.elapsed() < MINTED_FOR
}

/// Whether a request with `data`'s token may move the keyboard, given the
/// serial of the keyboard's last `enter`.
pub fn granted(data: &XdgActivationTokenData, last_enter: Option<Serial>) -> bool {
    if data.user_data.get::<Minted>().is_some() {
        data.timestamp.elapsed() < MINTED_FOR
    } else {
        earned(data.serial.as_ref().map(|(serial, _)| *serial), last_enter)
    }
}

/// Whether a token made for `asked` may move the keyboard, given the serial of
/// the keyboard's last `enter`.
fn earned(asked: Option<Serial>, last_enter: Option<Serial>) -> bool {
    match (asked, last_enter) {
        (Some(asked), Some(last_enter)) => asked.is_no_older_than(&last_enter),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use smithay::wayland::xdg_activation::XdgActivationTokenData;

    use super::*;

    #[test]
    fn a_token_from_input_since_the_keyboard_last_moved_moves_it() {
        assert!(earned(Some(Serial::from(7)), Some(Serial::from(5))));
        assert!(earned(Some(Serial::from(5)), Some(Serial::from(5))));
    }

    #[test]
    fn a_token_from_before_the_keyboard_last_moved_does_not() {
        // A window handing itself the keyboard back after the user moved on.
        assert!(!earned(Some(Serial::from(4)), Some(Serial::from(5))));
    }

    #[test]
    fn a_token_without_a_serial_does_not() {
        assert!(!earned(None, Some(Serial::from(5))));
    }

    #[test]
    fn a_token_minted_for_the_user_moves_it_after_the_keyboard_moved() {
        // Closing the drawer hands the keyboard back to a window after the
        // notification click minted the token.
        assert!(granted(&minted(None), Some(Serial::from(5))));
    }

    #[test]
    fn a_token_minted_for_the_user_expires() {
        let stale = XdgActivationTokenData {
            timestamp: Instant::now() - MINTED_FOR,
            ..minted(None)
        };
        assert!(!granted(&stale, Some(Serial::from(5))));
    }

    #[test]
    fn a_press_lets_its_notifications_process_raise_its_window() {
        // An app that ignores `ActivationToken` and asks with its own token,
        // as Electron before 42 does.
        assert!(invites(&minted(Some(42)), 42));
    }

    #[test]
    fn a_press_lets_no_other_process() {
        assert!(!invites(&minted(Some(42)), 7));
        assert!(!invites(&minted(None), 42));
    }

    #[test]
    fn a_press_stops_letting_it_once_the_token_expires() {
        let stale = XdgActivationTokenData {
            timestamp: Instant::now() - MINTED_FOR,
            ..minted(Some(42))
        };
        assert!(!invites(&stale, 42));
    }

    #[test]
    fn a_clients_own_token_still_needs_a_recent_serial() {
        assert!(!granted(
            &XdgActivationTokenData::default(),
            Some(Serial::from(5))
        ));
    }
}
