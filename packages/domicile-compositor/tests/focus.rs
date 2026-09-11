//! Who the keyboard goes to, and who decides.
//!
//! The decision is the shell's: the compositor holds the seat because it is
//! the only thing that can deliver a key, but every move of it starts with a
//! shell saying so. A client that wants the keyboard asks, over
//! `xdg-activation`, and the compositor's whole part in that is to pass the
//! question on.
//!
//! Unit tests cover the near side — that `focus_requested` goes out and the
//! seat stays put. What needs a real client and a real compositor is the half
//! those cannot reach: that the global is advertised at all, that a client's
//! request crosses the socket, and that a shell answering it moves the seat.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

#[test]
fn a_client_asks_for_the_keyboard_and_the_shell_is_what_gives_it() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // Connected before the client starts, so the request is heard live rather
    // than through the replay a late chrome gets — which does not carry one:
    // a question that was already asked is not part of the desktop's state.
    let mut chrome = compositor.chrome();
    let _client = compositor.client_asking_for_focus("eager");

    let requested = chrome
        .wait_for(|message| matches!(message, HostMessage::FocusRequested { .. }))
        .expect("a client that binds xdg_activation_v1 and activates its surface is heard");
    let HostMessage::FocusRequested { app_id } = requested else {
        unreachable!("the wait matched on this variant")
    };

    // And the seat moves when the shell says so, not before. The two halves
    // fail apart: a compositor that granted the activation itself would send
    // the `focus_changed` below with nothing having asked for it, and one that
    // dropped the request would never send this.
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes an answer");

    // A window rather than any move at all: the chrome was caught up on who
    // held the keyboard when it connected, and that answer — itself, because
    // nothing had granted the request — is a `focus_changed` this would
    // otherwise match before the client had asked for anything.
    assert_eq!(
        chrome
            .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: Some(_) }))
            .expect("answering the request moves the keyboard"),
        HostMessage::FocusChanged {
            app_id: Some(app_id)
        }
    );
}
