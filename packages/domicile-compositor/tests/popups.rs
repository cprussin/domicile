//! A client's popups — its menus — reaching the chrome.
//!
//! A popup is an `<app>` of its own that the shell places over its window, so
//! everything here is about what the chrome is told and what the client is
//! told back: that the popup exists and where, that it is gone, and that a
//! chrome dismissing it reaches the client. What it looks like needs an
//! engine, and is the pixel guard's.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};
use domicile_test_chrome::Chrome;
use domicile_test_client::POPUP;

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

/// The window a client opened, by the id the chrome was told.
fn window_of(chrome: &mut Chrome) -> String {
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the client's window is announced");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    app_id
}

/// The popup a client opened, as the chrome was told it.
fn popup_of(chrome: &mut Chrome) -> HostMessage {
    chrome
        .wait_for(|message| matches!(message, HostMessage::PopupPlaced { .. }))
        .expect("a client's popup is announced")
}

/// A menu is announced over the window it belongs to, where its positioner
/// put it — which, placed against the window's own box, is where the shell has
/// to draw it.
#[test]
fn a_clients_popup_is_announced_over_its_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("a window with a menu", &["--popup"]);

    let window = window_of(&mut chrome);
    let HostMessage::PopupPlaced {
        app_id,
        parent,
        position,
        size,
        grab,
    } = popup_of(&mut chrome)
    else {
        unreachable!("the wait matched on this variant")
    };

    let (x, y, width, height) = POPUP;
    assert_ne!(app_id, window, "a popup is an app of its own");
    assert_eq!(parent, window);
    assert_eq!(position, [f64::from(x), f64::from(y)]);
    assert_eq!(size, [f64::from(width), f64::from(height)]);
    assert!(!grab, "this client never asked for a grab");
}

/// A chrome closing a popup dismisses it, which is how a shell takes a menu
/// down when a press lands outside it — and the client destroying it, as a
/// toolkit does on `popup_done`, is what the chrome hears back.
#[test]
fn a_popup_the_chrome_closes_is_dismissed_and_goes() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client_with("a window with a menu", &["--popup"]);
    let window = window_of(&mut chrome);
    let HostMessage::PopupPlaced { app_id: popup, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };

    chrome
        .say(&ChromeMessage::CloseApp {
            app_id: popup.clone(),
        })
        .expect("the chrome can ask");

    assert!(
        client.wait_for_trace("popup_done()", 1),
        "the client was told its popup is dismissed:\n{}",
        client.trace()
    );
    let closed = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("the popup's going is announced");
    assert_eq!(
        closed,
        HostMessage::AppClosed { app_id: popup },
        "and it is the popup that went, not {window}"
    );
    assert!(
        client.is_running(),
        "a menu closing is not its window closing"
    );
}

/// A pointer over a popup's `<app>` is over the popup's surface. The chrome
/// names the popup by its own id, and the point is the popup's own, which is
/// what a menu needs to highlight the item under it.
#[test]
fn a_pointer_over_a_popup_is_over_the_popups_surface() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client_with("a window with a menu", &["--popup"]);
    let HostMessage::PopupPlaced { app_id: popup, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };
    assert!(client.wait_for_trace(".opened(", 1));
    let trace = client.trace();
    let surface = trace
        .lines()
        .find_map(|line| line.split_once(".opened(").map(|(_, rest)| rest))
        .and_then(|rest| rest.strip_suffix(')'))
        .expect("the client says which surface its popup is")
        .to_string();

    chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: popup,
            x: 5.0,
            y: 6.0,
        })
        .expect("the chrome can move the pointer");

    assert!(
        client.wait_for_trace(&format!("{surface}, 5, 6)"), 1),
        "the pointer entered {surface} at the popup's own point:\n{}",
        client.trace()
    );
}

/// The surface a client's popup is, from its trace.
fn popup_surface(client: &mut running::Client) -> String {
    assert!(client.wait_for_trace(".opened(", 1));
    client
        .trace()
        .lines()
        .find_map(|line| line.split_once(".opened(").map(|(_, rest)| rest))
        .and_then(|rest| rest.strip_suffix(')'))
        .expect("the client says which surface its popup is")
        .to_string()
}

/// A menu that grabs is announced as one, and has the keyboard — which is
/// what lets the arrow keys walk it.
#[test]
fn a_grabbing_popup_is_said_to_grab_and_takes_the_keyboard() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client_with("a window with a menu", &["--popup-grab"]);
    let surface = popup_surface(&mut client);

    let HostMessage::PopupPlaced { grab, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };

    assert!(grab, "a popup that grabbed is announced as a menu");
    assert!(
        client.wait_for_trace(&format!("enter({surface})"), 1),
        "the keyboard went to the menu:\n{}",
        client.trace()
    );
}

/// A menu with the keyboard leaves its window the activated one: the window
/// is still what is being used, and a toolkit closes its menus when its window
/// stops being active.
#[test]
fn a_grabbing_popup_keeps_its_window_activated() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let _chrome = compositor.chrome();
    let mut client = compositor.client_with("a window with a menu", &["--popup-grab"]);

    assert!(
        client.wait_for_trace("activated(true)", 1),
        "the window whose menu has the keyboard was never activated:\n{}",
        client.trace()
    );
}

/// The keyboard moving anywhere but the menu's own window dismisses the menu,
/// as a click elsewhere does on any desktop. Moving it to that window does
/// not: a press on the menu is a press on its window to a shell, and a menu
/// that closed whenever it was clicked could not be used.
#[test]
fn a_grabbing_popup_goes_when_the_keyboard_leaves_its_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client_with("a window with a menu", &["--popup-grab"]);
    let window = window_of(&mut chrome);
    let HostMessage::PopupPlaced { app_id: popup, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };
    let surface = popup_surface(&mut client);

    chrome
        .say(&ChromeMessage::FocusApp { app_id: window })
        .expect("the chrome can move the keyboard");
    // Something the compositor answers after the focus, so the focus has been
    // handled by the time it is heard: the pointer entering the menu.
    chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: popup,
            x: 1.0,
            y: 1.0,
        })
        .expect("the chrome can move the pointer");
    assert!(client.wait_for_trace(&format!("{surface}, 1, 1)"), 1));
    assert!(
        !client.trace().contains("popup_done()"),
        "the menu stayed while its own window was focused:\n{}",
        client.trace()
    );

    chrome
        .say(&ChromeMessage::FocusChrome)
        .expect("the chrome can take the keyboard");
    assert!(
        client.wait_for_trace("popup_done()", 1),
        "the menu went when the keyboard left its window:\n{}",
        client.trace()
    );
}
