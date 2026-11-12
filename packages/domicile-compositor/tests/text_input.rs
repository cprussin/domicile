//! Composition from an input method into a native window: the editor is a
//! test client with `--text-input`, and the input method and virtual keyboard
//! are clients this file drives, as fcitx5 and IBus are.
//!
//! See `src/text_input.rs` for what the compositor adds to Smithay's relay,
//! and `docs/architecture/TEXT-INPUT.md` for the design.

mod running;

use std::os::fd::{AsFd as _, OwnedFd};
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};
use wayland_client::protocol::{wl_keyboard, wl_registry, wl_seat};
use wayland_client::{Connection, Dispatch, EventQueue, QueueHandle, WEnum};
use wayland_protocols_misc::zwp_input_method_v2::client::{
    zwp_input_method_keyboard_grab_v2::{self, ZwpInputMethodKeyboardGrabV2},
    zwp_input_method_manager_v2::ZwpInputMethodManagerV2,
    zwp_input_method_v2::{self, ZwpInputMethodV2},
};
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::{
    zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1,
    zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1,
};

use crate::running::{Client, Compositor};

const A_DESK: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// The same desk, with the shortest lock timeout the config accepts.
const A_DESK_THAT_LOCKS_IN_A_SECOND: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "idle": { "lock_after_seconds": 1 }
}
"#;

/// `a`, in evdev codes.
const EVDEV_KEY_A: u32 = 30;

/// How long to wait for the compositor to answer.
const PATIENCE: Duration = Duration::from_secs(10);

/// An input method or virtual keyboard: a client on the apps' display that
/// records what it hears.
struct Peer {
    queue: EventQueue<Heard>,
    heard: Heard,
    _connection: Connection,
}

#[derive(Default)]
struct Heard {
    seat: Option<wl_seat::WlSeat>,
    input_methods: Option<ZwpInputMethodManagerV2>,
    virtual_keyboards: Option<ZwpVirtualKeyboardManagerV1>,
    input_method: Option<ZwpInputMethodV2>,
    /// What the input method heard, in order: `activate`, `deactivate`,
    /// `surrounding_text(..)`, `done`, `unavailable`, and its grab's keys.
    said: Vec<String>,
    /// The seat's keymap, which a virtual keyboard sends back as its own.
    keymap: Option<(OwnedFd, u32)>,
}

impl Peer {
    fn connected(compositor: &Compositor) -> Peer {
        let socket = UnixStream::connect(compositor.wayland_socket())
            .expect("the apps' display takes a connection");
        let connection = Connection::from_socket(socket).expect("a Wayland connection");
        let mut queue = connection.new_event_queue();
        connection.display().get_registry(&queue.handle(), ());
        let mut heard = Heard::default();
        queue.roundtrip(&mut heard).expect("globals listed");
        Peer {
            queue,
            heard,
            _connection: connection,
        }
    }

    /// Binds an input method to the seat.
    fn an_input_method(compositor: &Compositor) -> Peer {
        let mut peer = Peer::connected(compositor);
        let manager = peer
            .heard
            .input_methods
            .clone()
            .expect("an unsandboxed client sees zwp_input_method_manager_v2");
        let seat = peer.heard.seat.clone().expect("a wl_seat");
        peer.heard.input_method = Some(manager.get_input_method(&seat, &peer.queue.handle(), ()));
        peer.roundtrip();
        peer
    }

    fn roundtrip(&mut self) {
        self.queue
            .roundtrip(&mut self.heard)
            .expect("the compositor answers");
    }

    /// Whether the peer heard `line` at least `wanted` times, waiting for it.
    fn waits_for(&mut self, line: &str, wanted: usize) -> bool {
        let until = Instant::now() + PATIENCE;
        loop {
            self.roundtrip();
            if self.heard.said.iter().filter(|said| *said == line).count() >= wanted {
                return true;
            }
            if Instant::now() >= until {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn input_method(&self) -> &ZwpInputMethodV2 {
        self.heard.input_method.as_ref().expect("bound")
    }

    /// Commits what was sent since the last commit, with the serial the
    /// protocol asks for: the number of `done`s heard.
    fn commit(&mut self) {
        let serial = self
            .heard
            .said
            .iter()
            .filter(|said| *said == "done")
            .count();
        self.input_method()
            .commit(u32::try_from(serial).expect("few dones"));
        self.roundtrip();
    }

    fn said(&self) -> String {
        format!("{:?}", self.heard.said)
    }
}

/// Starts an editor and gives it the keyboard. Returns it and its app id.
fn a_focused_editor(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    title: &str,
) -> (Client, String) {
    let editor = compositor.client_with(title, &["--text-input"]);
    let app_id = appeared(chrome);
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes a focus");
    (editor, app_id)
}

/// The id of the next window the chrome is told about.
fn appeared(chrome: &mut domicile_test_chrome::Chrome) -> String {
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    app_id
}

/// Preedit, commit and delete-surrounding reach the focused editor, each
/// followed by `done`.
#[test]
fn an_input_method_composes_into_the_focused_window() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = Peer::an_input_method(&compositor);
    let (mut editor, _) = a_focused_editor(&compositor, &mut chrome, "editor");

    assert!(
        ime.waits_for("activate", 1) && ime.waits_for("done", 1),
        "an enabled editor with the keyboard activates the input method; it heard {}\n{}",
        ime.said(),
        compositor.complaint()
    );
    assert!(
        ime.heard
            .said
            .contains(&"surrounding_text(\"typed so far\")".to_string()),
        "the input method reads the text around the cursor; it heard {}",
        ime.said()
    );

    ime.input_method()
        .set_preedit_string("ni".to_string(), 0, 2);
    ime.commit();
    assert!(
        editor.wait_for_trace("preedit(\"ni\", 0, 2)", 1)
            && editor.wait_for_trace("text_input_done(", 1),
        "the preedit reaches the editor with a done; it traced:\n{}",
        editor.trace()
    );

    ime.input_method().commit_string("你".to_string());
    ime.input_method().delete_surrounding_text(2, 0);
    ime.commit();
    assert!(
        editor.wait_for_trace("commit_string(\"你\")", 1)
            && editor.wait_for_trace("delete_surrounding(2, 0)", 1)
            && editor.wait_for_trace("text_input_done(", 2),
        "the committed text and the deletion reach the editor with a done; it traced:\n{}",
        editor.trace()
    );
}

/// The editor hears `leave` when the keyboard moves to another window, and
/// the input method is deactivated.
#[test]
fn an_editor_the_keyboard_leaves_hears_leave() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = Peer::an_input_method(&compositor);
    let (mut editor, _) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(ime.waits_for("activate", 1), "it heard {}", ime.said());

    let _other = compositor.client("other");
    let other_id = appeared(&mut chrome);
    chrome
        .say(&ChromeMessage::FocusApp { app_id: other_id })
        .expect("the chrome socket takes a focus");

    assert!(
        editor.wait_for_trace("text_input_leave(", 1),
        "the editor the keyboard left was never told; it traced:\n{}",
        editor.trace()
    );
    assert!(
        ime.waits_for("deactivate", 1),
        "the input method is deactivated with its editor gone; it heard {}",
        ime.said()
    );
}

/// The seat takes one input method. A second hears `unavailable`, and the
/// first keeps working.
#[test]
fn a_second_input_method_is_unavailable() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut first = Peer::an_input_method(&compositor);
    let mut second = Peer::an_input_method(&compositor);

    assert!(
        second.waits_for("unavailable", 1),
        "the second input method was never told; it heard {}",
        second.said()
    );
    assert!(
        !first.heard.said.contains(&"unavailable".to_string()),
        "the first input method keeps the seat; it heard {}",
        first.said()
    );

    let _editor = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(
        first.waits_for("activate", 1),
        "the first input method still serves an editor; it heard {}",
        first.said()
    );
    second.roundtrip();
    assert!(
        !second.heard.said.contains(&"activate".to_string()),
        "an unavailable input method serves nothing; it heard {}",
        second.said()
    );
}

/// An input method that disconnects frees the seat for the next.
#[test]
fn a_disconnected_input_method_frees_the_seat() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let first = Peer::an_input_method(&compositor);
    drop(first);
    compositor.wait_for_log("input method: gone; the seat takes another");

    let mut next = Peer::an_input_method(&compositor);
    let _editor = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(
        next.waits_for("activate", 1),
        "the next input method takes the seat; it heard {}",
        next.said()
    );
    assert!(
        !next.heard.said.contains(&"unavailable".to_string()),
        "it heard {}",
        next.said()
    );
}

/// An editor that disconnects deactivates the input method.
#[test]
fn a_disconnected_editor_deactivates_the_input_method() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = Peer::an_input_method(&compositor);
    let (editor, _) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(ime.waits_for("activate", 1), "it heard {}", ime.said());

    drop(editor);

    assert!(
        ime.waits_for("deactivate", 1),
        "the input method outlived its editor active; it heard {}",
        ime.said()
    );
}

/// An input method that grabs the keyboard hears the keys the engine passes
/// to the focused window, in place of the window.
#[test]
fn a_grabbing_input_method_hears_the_window_s_keys() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = Peer::an_input_method(&compositor);
    let (editor, app_id) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(ime.waits_for("activate", 1), "it heard {}", ime.said());
    let handle = ime.queue.handle();
    ime.input_method().grab_keyboard(&handle, ());
    ime.roundtrip();

    chrome
        .say(&ChromeMessage::Key {
            app_id,
            keycode: EVDEV_KEY_A,
            pressed: true,
        })
        .expect("the chrome socket takes a key");

    assert!(
        ime.waits_for(&format!("key({EVDEV_KEY_A}, 1)"), 1),
        "the grab never heard the key; it heard {}\n{}",
        ime.said(),
        compositor.complaint()
    );
    assert!(
        !editor.trace().contains(", 30, 1)"),
        "the key went to the input method, not the window; it traced:\n{}",
        editor.trace()
    );
}

/// A virtual keyboard's keys reach the focused window.
#[test]
fn a_virtual_keyboard_types_into_the_focused_window() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let (mut editor, _) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(
        editor.wait_for_trace("activated(true)", 1),
        "the editor never had the keyboard; it traced:\n{}",
        editor.trace()
    );
    let keyboard = a_virtual_keyboard(&compositor);

    keyboard.1.key(0, EVDEV_KEY_A, 1);
    keyboard.1.key(0, EVDEV_KEY_A, 0);
    let mut peer = keyboard.0;
    peer.roundtrip();

    assert!(
        editor.wait_for_trace(", 30, 1)", 1) && editor.wait_for_trace(", 30, 0)", 1),
        "the virtual keyboard's key never reached the window; it traced:\n{}",
        editor.trace()
    );
}

/// A virtual keyboard with the seat's keymap.
fn a_virtual_keyboard(compositor: &Compositor) -> (Peer, ZwpVirtualKeyboardV1) {
    let mut peer = Peer::connected(compositor);
    let seat = peer.heard.seat.clone().expect("a wl_seat");
    let handle = peer.queue.handle();
    seat.get_keyboard(&handle, ());
    let until = Instant::now() + PATIENCE;
    while peer.heard.keymap.is_none() && Instant::now() < until {
        peer.roundtrip();
    }
    let (keymap, size) = peer.heard.keymap.take().expect("the seat sends a keymap");
    let manager = peer
        .heard
        .virtual_keyboards
        .clone()
        .expect("an unsandboxed client sees zwp_virtual_keyboard_manager_v1");
    let keyboard = manager.create_virtual_keyboard(&seat, &handle, ());
    keyboard.keymap(
        wl_keyboard::KeymapFormat::XkbV1.into(),
        keymap.as_fd(),
        size,
    );
    peer.roundtrip();
    (peer, keyboard)
}

/// While the desk is locked, neither an input method's text nor a virtual
/// keyboard's presses reach the window that had the keyboard.
#[test]
fn nothing_reaches_an_editor_on_a_locked_desk() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = Peer::an_input_method(&compositor);
    let (editor, _) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(ime.waits_for("activate", 1), "it heard {}", ime.said());
    let (mut keyboard_peer, keyboard) = a_virtual_keyboard(&compositor);

    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: false }))
        .expect("a desk that can lock tells a page that says hello it is open");
    compositor.reconfigure(A_DESK_THAT_LOCKS_IN_A_SECOND);
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .expect("a desk nobody is at locks itself and says so");

    ime.input_method().commit_string("secret".to_string());
    ime.commit();
    compositor.wait_for_log("input method: the desk is locked; its text reaches no editor");
    keyboard.key(0, EVDEV_KEY_A, 1);
    keyboard_peer.roundtrip();
    compositor.wait_for_log("virtual keyboard: the desk is locked; its press reaches no window");

    assert!(
        !editor.trace().contains("commit_string(\"secret\")"),
        "text reached a window behind the lock; it traced:\n{}",
        editor.trace()
    );
    assert!(
        !editor.trace().contains(", 30, 1)"),
        "a press reached a window behind the lock; it traced:\n{}",
        editor.trace()
    );
}

impl Dispatch<wl_registry::WlRegistry, ()> for Heard {
    fn event(
        heard: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        handle: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name, interface, ..
        } = event
        {
            match interface.as_str() {
                "wl_seat" => heard.seat = Some(registry.bind(name, 5, handle, ())),
                "zwp_input_method_manager_v2" => {
                    heard.input_methods = Some(registry.bind(name, 1, handle, ()));
                }
                "zwp_virtual_keyboard_manager_v1" => {
                    heard.virtual_keyboards = Some(registry.bind(name, 1, handle, ()));
                }
                _ => {}
            }
        }
    }
}

impl Dispatch<ZwpInputMethodV2, ()> for Heard {
    fn event(
        heard: &mut Self,
        _: &ZwpInputMethodV2,
        event: zwp_input_method_v2::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        heard.said.push(match event {
            zwp_input_method_v2::Event::Activate => "activate".to_string(),
            zwp_input_method_v2::Event::Deactivate => "deactivate".to_string(),
            zwp_input_method_v2::Event::SurroundingText { text, .. } => {
                format!("surrounding_text({text:?})")
            }
            zwp_input_method_v2::Event::Done => "done".to_string(),
            zwp_input_method_v2::Event::Unavailable => "unavailable".to_string(),
            zwp_input_method_v2::Event::TextChangeCause { .. } => "text_change_cause".to_string(),
            zwp_input_method_v2::Event::ContentType { .. } => "content_type".to_string(),
            _ => "unknown".to_string(),
        });
    }
}

impl Dispatch<ZwpInputMethodKeyboardGrabV2, ()> for Heard {
    fn event(
        heard: &mut Self,
        _: &ZwpInputMethodKeyboardGrabV2,
        event: zwp_input_method_keyboard_grab_v2::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let zwp_input_method_keyboard_grab_v2::Event::Key { key, state, .. } = event {
            let pressed = matches!(state, WEnum::Value(wl_keyboard::KeyState::Pressed));
            heard
                .said
                .push(format!("key({key}, {})", u8::from(pressed)));
        }
    }
}

impl Dispatch<wl_keyboard::WlKeyboard, ()> for Heard {
    fn event(
        heard: &mut Self,
        _: &wl_keyboard::WlKeyboard,
        event: wl_keyboard::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let wl_keyboard::Event::Keymap { fd, size, .. } = event {
            heard.keymap = Some((fd, size));
        }
    }
}

wayland_client::delegate_noop!(Heard: ignore wl_seat::WlSeat);
wayland_client::delegate_noop!(Heard: ignore ZwpInputMethodManagerV2);
wayland_client::delegate_noop!(Heard: ignore ZwpVirtualKeyboardManagerV1);
wayland_client::delegate_noop!(Heard: ignore ZwpVirtualKeyboardV1);
