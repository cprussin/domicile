//! A client ringing `xdg_system_bell_v1` reaches every page listening for
//! bells, with the window that rang. The compositor makes no sound; the shell
//! decides what a bell means.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage, SystemEvent, SystemReply, SystemRequest};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

#[test]
fn a_bell_reaches_the_shell_with_the_window_that_rang() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 1,
            request: SystemRequest::Bells,
        })
        .expect("the chrome socket takes a system call");
    assert_eq!(
        chrome
            .wait_for(|message| matches!(message, HostMessage::SystemReply { id: 1, .. }))
            .expect("a system call is answered"),
        HostMessage::SystemReply {
            id: 1,
            reply: SystemReply::Started,
        }
    );

    let _client = compositor.client_with("ringing", &["--ring-the-bell"]);
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the window is announced");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    let rings: Vec<HostMessage> = (0..2)
        .map(|_| {
            chrome
                .wait_for(|message| matches!(message, HostMessage::SystemEvent { id: 1, .. }))
                .expect("each ring is heard")
        })
        .collect();
    assert_eq!(
        rings,
        vec![
            HostMessage::SystemEvent {
                id: 1,
                event: SystemEvent::Bell {
                    app_id: Some(app_id),
                },
            },
            HostMessage::SystemEvent {
                id: 1,
                event: SystemEvent::Bell { app_id: None },
            },
        ],
        "a ring names its window, and one with no surface names none"
    );
}
