//! A client's popups (its menus, and the bubbles Chromium draws as
//! subsurfaces) reaching the chrome.
//!
//! A popup is its own `<app>`, placed by the shell over its window. These
//! tests cover the messages both ways: the popup appearing and where, going
//! away, and a chrome dismissing it. Rendering is covered by the pixel tests.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};
use domicile_test_chrome::Chrome;
use domicile_test_client::{scrolled_to, BUBBLE, BUBBLE_GROWN, POPUP, SCROLLING_BUBBLE};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// Two screens side by side, so a menu past the left one's right edge is
/// still on the desktop.
const TWO_DISPLAYS: &str = r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [1920, 1080] }
    ]
  }
}
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

/// A menu is announced over its window, where its positioner put it relative
/// to the window's box. That is where the shell draws it.
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
        ..
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

/// A chrome closing a popup dismisses it, as a shell does on a press outside
/// the menu. The client then destroys it, as a toolkit does on `popup_done`,
/// and the chrome is told.
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
/// names the popup by its own id and gives popup-local coordinates, so the
/// menu can highlight the item under the pointer.
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
            moved: true,
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

/// A grabbing menu is announced as one and gets the keyboard, so arrow keys
/// work in it.
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

/// A menu with the keyboard keeps its window activated: toolkits close menus
/// when their window is deactivated.
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

/// Moving the keyboard anywhere but the menu's own window dismisses the menu,
/// like a click elsewhere. Moving it to that window does not, because a shell
/// treats a press on the menu as a press on its window.
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
    // The pointer entering the menu is answered after the focus, so the focus
    // has been handled once it arrives.
    chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: popup,
            x: 1.0,
            y: 1.0,
            moved: true,
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

/// A box as the chrome is told it: its position and its size.
fn placement((x, y, width, height): (i32, i32, i32, i32)) -> ([f64; 2], [f64; 2]) {
    (
        [f64::from(x), f64::from(y)],
        [f64::from(width), f64::from(height)],
    )
}

/// Chromium draws an extension popup as a desync subsurface of its window.
/// It is announced as a popup over that window, and placed again as it grows
/// to fit its page.
#[test]
fn a_subsurface_bubble_is_announced_over_its_window_and_follows_its_growth() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("a window with a bubble", &["--bubble"]);

    let window = window_of(&mut chrome);
    let HostMessage::PopupPlaced {
        app_id,
        parent,
        position,
        size,
        grab,
        frames,
    } = popup_of(&mut chrome)
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(parent, window);
    assert_eq!((position, size), placement(BUBBLE));
    assert!(!grab, "a bubble never grabs");
    // Frames sync only with an engine that syncs them and a page that asks.
    assert_eq!(frames, vec![], "nothing asked for synced frames");

    let (position, size) = placement(BUBBLE_GROWN);
    let grown = chrome.wait_for(|message| {
        *message
            == HostMessage::PopupPlaced {
                app_id: app_id.clone(),
                parent: window.clone(),
                position,
                size,
                grab: false,
                frames: vec![],
            }
    });
    assert!(grown.is_ok(), "the grown bubble was placed again");
}

/// A page scrolling under an anchored popup: each frame, the window's content
/// and its sync bubble's move come in one commit. The bubble is placed again
/// at each frame's stripe.
#[test]
fn a_sync_bubble_is_placed_again_at_each_scroll_of_its_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with(
        "a window that scrolls under a bubble",
        &["--scrolling-bubble"],
    );

    let window = window_of(&mut chrome);
    let (x, width, height) = SCROLLING_BUBBLE;
    let mut tops: Vec<f64> = Vec::new();
    while tops.len() < 3 {
        let HostMessage::PopupPlaced {
            parent,
            position,
            size,
            ..
        } = popup_of(&mut chrome)
        else {
            unreachable!("the wait matched on this variant")
        };
        assert_eq!(parent, window);
        assert_eq!(size, [f64::from(width), f64::from(height)]);
        assert_eq!(position[0], f64::from(x));
        assert!(
            (0..100).any(|frame| f64::from(scrolled_to(frame)) == position[1]),
            "the bubble is at {position:?}, which is no frame's stripe"
        );
        if !tops.contains(&position[1]) {
            tops.push(position[1]);
        }
    }
}

/// A pointer over a bubble's `<app>` is over the bubble's surface. Chromium
/// hides a bubble by destroying its `wl_subsurface` and keeping the surface;
/// the chrome is then told it is gone.
#[test]
fn a_bubble_takes_the_pointer_and_goes_when_hidden() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client_with("a window with a bubble", &["--bubble"]);
    let HostMessage::PopupPlaced { app_id: bubble, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };
    let surface = popup_surface(&mut client);

    chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: bubble.clone(),
            x: 5.0,
            y: 6.0,
            moved: true,
        })
        .expect("the chrome can move the pointer");
    assert!(
        client.wait_for_trace(&format!("{surface}, 5, 6)"), 1),
        "the pointer entered {surface} at the bubble's own point:\n{}",
        client.trace()
    );
    chrome
        .say(&ChromeMessage::PointerButton {
            app_id: bubble.clone(),
            button: 0x110,
            pressed: true,
        })
        .expect("the chrome can press");

    assert!(client.wait_for_trace("hid()", 1), "{}", client.trace());
    let closed = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("the bubble's going is announced");
    assert_eq!(closed, HostMessage::AppClosed { app_id: bubble });
}

/// A bubble whose surface is destroyed goes, as when Chromium closes an
/// extension popup or exits.
#[test]
fn a_bubble_goes_with_its_client() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let client = compositor.client_with("a window with a bubble", &["--bubble"]);
    let HostMessage::PopupPlaced { app_id: bubble, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };

    drop(client);

    let closed = chrome.wait_for(|message| {
        *message
            == HostMessage::AppClosed {
                app_id: bubble.clone(),
            }
    });
    assert!(closed.is_ok(), "the bubble's going is announced");
}

/// A press over `app_id`, which opens a `--sliding-menu` over it.
fn press(chrome: &mut Chrome, app_id: &str) {
    chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: app_id.to_string(),
            x: 1.0,
            y: 1.0,
            moved: true,
        })
        .expect("the chrome can move the pointer");
    for pressed in [true, false] {
        chrome
            .say(&ChromeMessage::PointerButton {
                app_id: app_id.to_string(),
                button: 0x110,
                pressed,
            })
            .expect("the chrome can press");
    }
}

/// A `--sliding-menu` window the page put in a 100 by 100 box at the left
/// screen's bottom right corner, mostly on that screen. Its menu, unmoved,
/// would cross that screen's right edge by 60 and its bottom edge by 30.
fn a_window_in_the_corner(chrome: &mut Chrome) -> String {
    let window = window_of(chrome);
    chrome
        .say(&ChromeMessage::SetAppBounds {
            app_id: window.clone(),
            position: [1850.0, 1010.0],
            size: [100.0, 100.0],
        })
        .expect("the chrome reports where it put the window");
    window
}

/// A menu that would cross the edge of its window's screen slides back onto
/// that screen, as its positioner allows. The screen next to it does not
/// count: a menu split across two screens is cut in half.
#[test]
fn a_menu_past_its_screens_edge_slides_back_onto_it() {
    let compositor = Compositor::started_with(TWO_DISPLAYS);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("a window with sliding menus", &["--sliding-menu"]);
    let window = a_window_in_the_corner(&mut chrome);

    press(&mut chrome, &window);

    let HostMessage::PopupPlaced {
        parent, position, ..
    } = popup_of(&mut chrome)
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(parent, window);
    assert_eq!(
        position,
        [-50.0, -10.0],
        "the menu ends at the screen's corner"
    );
}

/// A menu opened from a menu slides onto its window's screen too, counting
/// where the menu under it is.
#[test]
fn a_nested_menu_slides_back_onto_its_windows_screen() {
    let compositor = Compositor::started_with(TWO_DISPLAYS);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("a window with sliding menus", &["--sliding-menu"]);
    let window = a_window_in_the_corner(&mut chrome);
    press(&mut chrome, &window);
    let HostMessage::PopupPlaced { app_id: menu, .. } = popup_of(&mut chrome) else {
        unreachable!("the wait matched on this variant")
    };

    press(&mut chrome, &menu);

    let HostMessage::PopupPlaced {
        parent, position, ..
    } = popup_of(&mut chrome)
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(parent, menu);
    // The menu under it already ends at the corner, so it covers that menu.
    assert_eq!(position, [0.0, 0.0]);
}
