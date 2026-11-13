//! Composition from an input method into a native window: the editor is a
//! test client with `--text-input`, and the input method and virtual keyboard
//! are clients this file drives, as fcitx5 and IBus are.
//!
//! See `src/text_input.rs` for what the compositor adds to Smithay's relay,
//! and `docs/architecture/TEXT-INPUT.md` for the design.

mod running;

use std::cell::Cell;
use std::fs::File;
use std::os::fd::{AsFd as _, FromRawFd as _, OwnedFd};
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage, Preedit, Surrounding, TextField};
use wayland_client::protocol::{
    wl_buffer, wl_compositor, wl_keyboard, wl_registry, wl_seat, wl_shm, wl_shm_pool, wl_surface,
};
use wayland_client::{Connection, Dispatch, EventQueue, QueueHandle, WEnum};
use wayland_protocols_misc::zwp_input_method_v2::client::{
    zwp_input_method_keyboard_grab_v2::{self, ZwpInputMethodKeyboardGrabV2},
    zwp_input_method_manager_v2::ZwpInputMethodManagerV2,
    zwp_input_method_v2::{self, ZwpInputMethodV2},
    zwp_input_popup_surface_v2::{self, ZwpInputPopupSurfaceV2},
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

/// `a` and `s`, in evdev codes.
const EVDEV_KEY_A: u32 = 30;
const EVDEV_KEY_S: u32 = 31;

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
    compositor: Option<wl_compositor::WlCompositor>,
    shm: Option<wl_shm::WlShm>,
    /// The memory behind the buffers the peer drew.
    drawn: Vec<OwnedFd>,
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

    /// Opens the input method's candidate list, which draws nothing yet.
    fn a_candidate_list(&mut self) -> (wl_surface::WlSurface, ZwpInputPopupSurfaceV2) {
        let handle = self.queue.handle();
        let surface = self
            .heard
            .compositor
            .as_ref()
            .expect("a wl_compositor")
            .create_surface(&handle, ());
        let popup = self
            .input_method()
            .get_input_popup_surface(&surface, &handle, ());
        self.roundtrip();
        (surface, popup)
    }

    /// Draws `surface` blank at `size`, logical, and commits it.
    fn draw(&mut self, surface: &wl_surface::WlSurface, size: (i32, i32)) {
        let handle = self.queue.handle();
        let (width, height) = size;
        let length = width * 4 * height;
        let memory = memory(u64::try_from(length).expect("a positive size"));
        let pool = self.heard.shm.as_ref().expect("a wl_shm").create_pool(
            memory.as_fd(),
            length,
            &handle,
            (),
        );
        let buffer = pool.create_buffer(
            0,
            width,
            height,
            width * 4,
            wl_shm::Format::Argb8888,
            &handle,
            (),
        );
        pool.destroy();
        surface.attach(Some(&buffer), 0, 0);
        surface.damage_buffer(0, 0, width, height);
        surface.commit();
        self.heard.drawn.push(memory);
        self.roundtrip();
    }
}

/// Shared memory `length` bytes long.
fn memory(length: u64) -> OwnedFd {
    // SAFETY: a fresh memfd, owned here.
    let fd = unsafe { libc::memfd_create(c"candidates".as_ptr(), 0) };
    assert!(fd >= 0, "a memfd");
    // SAFETY: `fd` is open and owned by nothing else.
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    File::from(fd.try_clone().expect("a duplicate"))
        .set_len(length)
        .expect("sized");
    fd
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

/// The test client's text cursor rectangle, from `--text-input`.
const CARET: (i32, i32, i32, i32) = domicile_test_client::CARET;

/// The candidate list's size as the input method draws it.
const CANDIDATES: (i32, i32) = (120, 30);

/// An input method with a candidate list drawn over a focused editor, as the
/// chrome was told it: the list's app id and placement, and the editor's app
/// id.
struct Shown {
    compositor: Compositor,
    chrome: domicile_test_chrome::Chrome,
    ime: Peer,
    editor: Client,
    editor_id: String,
    surface: wl_surface::WlSurface,
    app_id: String,
    parent: String,
    position: [f64; 2],
    size: [f64; 2],
    grab: bool,
}

fn a_shown_candidate_list() -> Shown {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = Peer::an_input_method(&compositor);
    let (mut editor, editor_id) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(
        ime.waits_for("activate", 1) && editor.wait_for_trace("cursor_rectangle(", 1),
        "the editor took the keyboard and placed its text cursor; the input method heard {}\n{}",
        ime.said(),
        editor.trace()
    );
    let (surface, _popup) = ime.a_candidate_list();
    ime.draw(&surface, CANDIDATES);
    let placed = chrome
        .wait_for(|message| matches!(message, HostMessage::PopupPlaced { .. }))
        .unwrap_or_else(|_| {
            panic!(
                "a drawn candidate list is announced\n{}",
                compositor.complaint()
            )
        });
    let HostMessage::PopupPlaced {
        app_id,
        parent,
        position,
        size,
        grab,
        ..
    } = placed
    else {
        unreachable!("the wait matched on this variant")
    };
    Shown {
        compositor,
        chrome,
        ime,
        editor,
        editor_id,
        surface,
        app_id,
        parent,
        position,
        size,
        grab,
    }
}

/// Where the candidate list goes under a text cursor at `caret_x`: the test
/// client sets no window geometry, so its surface and window corners match.
fn under_a_caret_at(caret_x: i32) -> [f64; 2] {
    let (_, y, _, height) = CARET;
    [f64::from(caret_x), f64::from(y + height)]
}

/// The input method's candidate list is a popup of the editor's window, under
/// its text cursor, at the size the input method drew it.
#[test]
fn a_candidate_list_shows_under_the_editors_text_cursor() {
    let shown = a_shown_candidate_list();
    assert_eq!(
        shown.parent, shown.editor_id,
        "it is over the editor's window"
    );
    assert_eq!(
        shown.position,
        under_a_caret_at(CARET.0),
        "it is under the text cursor"
    );
    assert_eq!(
        shown.size,
        [f64::from(CANDIDATES.0), f64::from(CANDIDATES.1)],
        "it is the size the input method drew"
    );
    assert!(
        !shown.grab,
        "it takes no grab: typing goes on in the editor"
    );
}

/// The candidate list moves with the editor's text cursor: committed text
/// moves the cursor right, and the list follows.
#[test]
fn the_candidate_list_follows_the_text_cursor() {
    let mut shown = a_shown_candidate_list();
    shown.ime.input_method().commit_string("你好".to_string());
    shown.ime.commit();
    assert!(
        shown.editor.wait_for_trace("commit_string(\"你好\")", 1),
        "the editor took the text; it traced:\n{}",
        shown.editor.trace()
    );

    let moved_to = under_a_caret_at(CARET.0 + 2 * domicile_test_client::CARET_ADVANCE);
    let app_id = shown.app_id.clone();
    let moved = shown.chrome.wait_for(|message| {
        matches!(
            message,
            HostMessage::PopupPlaced { app_id: moved, position, .. }
                if *moved == app_id && *position == moved_to
        )
    });
    assert!(
        moved.is_ok(),
        "the candidate list moved to {moved_to:?} with the text cursor\n{}",
        shown.compositor.complaint()
    );
}

/// The candidate list closes when its editor loses the keyboard.
#[test]
fn the_candidate_list_closes_when_the_editor_loses_the_keyboard() {
    let mut shown = a_shown_candidate_list();
    let _other = shown.compositor.client("other");
    let other_id = appeared(&mut shown.chrome);
    shown
        .chrome
        .say(&ChromeMessage::FocusApp { app_id: other_id })
        .expect("the chrome socket takes a focus");

    let app_id = shown.app_id.clone();
    let closed = shown.chrome.wait_for(
        |message| matches!(message, HostMessage::AppClosed { app_id: closed } if *closed == app_id),
    );
    assert!(
        closed.is_ok(),
        "the candidate list closed with its editor's focus\n{}",
        shown.compositor.complaint()
    );
}

/// The candidate list closes when its input method goes.
#[test]
fn the_candidate_list_closes_with_its_input_method() {
    let mut shown = a_shown_candidate_list();
    drop(shown.ime);

    let app_id = shown.app_id.clone();
    let closed = shown.chrome.wait_for(
        |message| matches!(message, HostMessage::AppClosed { app_id: closed } if *closed == app_id),
    );
    assert!(
        closed.is_ok(),
        "the candidate list closed with its input method\n{}",
        shown.compositor.complaint()
    );
}

/// A candidate list that draws nothing closes, and shows again, as a new
/// popup, at its next frame. Input methods hide the list between words so.
#[test]
fn an_emptied_candidate_list_closes_until_it_draws_again() {
    let mut shown = a_shown_candidate_list();
    shown.surface.attach(None, 0, 0);
    shown.surface.commit();
    shown.ime.roundtrip();

    let app_id = shown.app_id.clone();
    let closed = shown.chrome.wait_for(
        |message| matches!(message, HostMessage::AppClosed { app_id: closed } if *closed == app_id),
    );
    assert!(
        closed.is_ok(),
        "the emptied candidate list closed\n{}",
        shown.compositor.complaint()
    );

    let surface = shown.surface.clone();
    shown.ime.draw(&surface, CANDIDATES);
    let editor_id = shown.editor_id.clone();
    let again = shown.chrome.wait_for(|message| {
        matches!(
            message,
            HostMessage::PopupPlaced { app_id: again, parent, .. }
                if *again != app_id && *parent == editor_id
        )
    });
    assert!(
        again.is_ok(),
        "the candidate list showed again when it drew\n{}",
        shown.compositor.complaint()
    );
}

/// A focused field in a page, as the browser describes it.
fn a_page_field(text: &str) -> ChromeMessage {
    ChromeMessage::TextInput {
        field: TextField {
            enabled: true,
            surrounding: Some(Surrounding {
                text: text.to_string(),
                cursor: u32::try_from(text.len()).expect("short"),
                anchor: u32::try_from(text.len()).expect("short"),
            }),
            hint: 0,
            purpose: 0,
            cursor: Some([200, 100, 2, 18]),
        },
    }
}

/// The browser's next composition, waiting for it.
fn composed(chrome: &mut domicile_test_chrome::Chrome, compositor: &Compositor) -> HostMessage {
    chrome
        .wait_for(|message| matches!(message, HostMessage::Composition { .. }))
        .unwrap_or_else(|_| {
            panic!(
                "the browser heard no composition\n{}",
                compositor.complaint()
            )
        })
}

/// An input method holding the keyboard, and a page field with the keyboard
/// as its editor, the browser told its keys go to the input method first.
fn a_composing_page(compositor: &Compositor, chrome: &mut domicile_test_chrome::Chrome) -> Peer {
    let mut ime = Peer::an_input_method(compositor);
    let handle = ime.queue.handle();
    ime.input_method().grab_keyboard(&handle, ());
    ime.roundtrip();
    chrome
        .say(&a_page_field("typed in a page"))
        .expect("the chrome socket takes a field");
    assert!(
        ime.waits_for("activate", 1),
        "a page field with the keyboard activates the input method; it heard {}\n{}",
        ime.said(),
        compositor.complaint()
    );
    let told = chrome.wait_for(|message| *message == HostMessage::InputMethod { composing: true });
    assert!(
        told.is_ok(),
        "the browser is told its keys go to the input method\n{}",
        compositor.complaint()
    );
    ime
}

/// A page field is the input method's editor while the browser has the
/// keyboard: the input method reads its text, and what it composes reaches
/// the browser.
#[test]
fn a_page_field_composes_from_the_input_method() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = a_composing_page(&compositor, &mut chrome);
    assert!(
        ime.waits_for("surrounding_text(\"typed in a page\")", 1),
        "the input method reads the page field's text; it heard {}",
        ime.said()
    );

    ime.input_method()
        .set_preedit_string("ni".to_string(), 0, 2);
    ime.commit();
    let HostMessage::Composition {
        preedit,
        commit,
        delete,
        ..
    } = composed(&mut chrome, &compositor)
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(
        (preedit, commit, delete),
        (
            Some(Preedit {
                text: "ni".to_string(),
                cursor_begin: 0,
                cursor_end: 2
            }),
            None,
            None
        ),
        "the preedit reaches the browser"
    );

    ime.input_method().commit_string("你".to_string());
    ime.input_method().delete_surrounding_text(2, 0);
    ime.commit();
    let HostMessage::Composition {
        preedit,
        commit,
        delete,
        ..
    } = composed(&mut chrome, &compositor)
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(
        (preedit, commit, delete),
        (None, Some("你".to_string()), Some([2, 0])),
        "the committed text and the deletion reach the browser, and the preedit clears"
    );
}

/// A key typed in a page goes to the input method first, and what the input
/// method passes on comes back to the browser.
#[test]
fn a_page_key_goes_to_the_input_method_and_back() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = a_composing_page(&compositor, &mut chrome);

    chrome
        .say(&ChromeMessage::KeyForInputMethod {
            keycode: EVDEV_KEY_A,
            pressed: true,
        })
        .expect("the chrome socket takes a key");
    assert!(
        ime.waits_for(&format!("key({EVDEV_KEY_A}, 1)"), 1),
        "the input method's grab hears the page's key; it heard {}\n{}",
        ime.said(),
        compositor.complaint()
    );

    // An input method passes on a key it does not compose with a virtual
    // keyboard, as fcitx5 does.
    let (mut keyboard_peer, keyboard) = a_virtual_keyboard(&compositor);
    keyboard.key(0, EVDEV_KEY_A, 1);
    keyboard_peer.roundtrip();
    let passed = chrome.wait_for(|message| {
        matches!(message, HostMessage::KeyPassed { keycode, pressed: true, .. } if *keycode == EVDEV_KEY_A)
    });
    assert!(
        passed.is_ok(),
        "the key the input method passed on reaches the browser\n{}",
        compositor.complaint()
    );
}

/// With no input method, a page's key comes straight back, and the browser is
/// never told to send keys to one.
#[test]
fn a_page_key_comes_straight_back_with_no_input_method() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    chrome
        .say(&a_page_field("typed in a page"))
        .expect("the chrome socket takes a field");
    chrome
        .say(&ChromeMessage::KeyForInputMethod {
            keycode: EVDEV_KEY_A,
            pressed: true,
        })
        .expect("the chrome socket takes a key");

    let composing = Cell::new(false);
    let passed = chrome.wait_for(|message| {
        if *message == (HostMessage::InputMethod { composing: true }) {
            composing.set(true);
        }
        matches!(message, HostMessage::KeyPassed { keycode, pressed: true, .. } if *keycode == EVDEV_KEY_A)
    });
    assert!(
        passed.is_ok(),
        "the key came back\n{}",
        compositor.complaint()
    );
    assert!(
        !composing.get(),
        "nothing composes, so the browser keeps its keys"
    );
}

/// The input method follows the keyboard between a page and a native window:
/// the window's text is read while it has the keyboard, and the page's once
/// the browser takes it back.
#[test]
fn the_input_method_follows_the_keyboard_between_a_page_and_a_window() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = a_composing_page(&compositor, &mut chrome);

    let (mut editor, _) = a_focused_editor(&compositor, &mut chrome, "editor");
    assert!(
        ime.waits_for("surrounding_text(\"typed so far\")", 1),
        "the window with the keyboard is the editor; the input method heard {}",
        ime.said()
    );
    let stopped =
        chrome.wait_for(|message| *message == HostMessage::InputMethod { composing: false });
    assert!(
        stopped.is_ok(),
        "the browser keeps its keys while a window has the keyboard"
    );
    ime.input_method().commit_string("你".to_string());
    ime.commit();
    assert!(
        editor.wait_for_trace("commit_string(\"你\")", 1),
        "the window gets the text; it traced:\n{}",
        editor.trace()
    );

    chrome
        .say(&ChromeMessage::FocusChrome)
        .expect("the chrome socket takes a focus");
    assert!(
        editor.wait_for_trace("text_input_leave(", 1),
        "the window loses the editor; it traced:\n{}",
        editor.trace()
    );
    assert!(
        ime.waits_for("surrounding_text(\"typed in a page\")", 2),
        "the page is the editor again; the input method heard {}",
        ime.said()
    );
    let resumed =
        chrome.wait_for(|message| *message == HostMessage::InputMethod { composing: true });
    assert!(
        resumed.is_ok(),
        "the browser's keys go to the input method again\n{}",
        compositor.complaint()
    );
}

/// On a locked desk the browser keeps its keys, so the lock page's field takes
/// them, and an input method's text reaches no page.
#[test]
fn a_locked_desk_keeps_the_browsers_keys() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    let mut ime = a_composing_page(&compositor, &mut chrome);

    compositor.reconfigure(A_DESK_THAT_LOCKS_IN_A_SECOND);
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .expect("a desk nobody is at locks itself and says so");
    let stopped =
        chrome.wait_for(|message| *message == HostMessage::InputMethod { composing: false });
    assert!(
        stopped.is_ok(),
        "the browser keeps its keys on a locked desk\n{}",
        compositor.complaint()
    );

    chrome
        .say(&ChromeMessage::KeyForInputMethod {
            keycode: EVDEV_KEY_A,
            pressed: true,
        })
        .expect("the chrome socket takes a key");
    let passed = chrome.wait_for(
        |message| matches!(message, HostMessage::KeyPassed { keycode, .. } if *keycode == EVDEV_KEY_A),
    );
    assert!(passed.is_ok(), "a key on a locked desk comes straight back");

    ime.input_method().commit_string("secret".to_string());
    ime.commit();
    compositor.wait_for_log("input method: the desk is locked; its text reaches no editor");
    // A key after the text, so everything the browser heard before it is in.
    chrome
        .say(&ChromeMessage::KeyForInputMethod {
            keycode: EVDEV_KEY_S,
            pressed: true,
        })
        .expect("the chrome socket takes a key");
    let composed = Cell::new(false);
    let after = chrome.wait_for(|message| {
        if matches!(
            message,
            HostMessage::Composition {
                commit: Some(_),
                ..
            }
        ) {
            composed.set(true);
        }
        matches!(message, HostMessage::KeyPassed { keycode, .. } if *keycode == EVDEV_KEY_S)
    });
    assert!(after.is_ok(), "the second key came back too");
    assert!(
        !composed.get(),
        "the input method's text reached the browser on a locked desk"
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
                "wl_compositor" => heard.compositor = Some(registry.bind(name, 4, handle, ())),
                "wl_shm" => heard.shm = Some(registry.bind(name, 1, handle, ())),
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
wayland_client::delegate_noop!(Heard: ignore wl_compositor::WlCompositor);
wayland_client::delegate_noop!(Heard: ignore wl_surface::WlSurface);
wayland_client::delegate_noop!(Heard: ignore wl_shm::WlShm);
wayland_client::delegate_noop!(Heard: ignore wl_shm_pool::WlShmPool);
wayland_client::delegate_noop!(Heard: ignore wl_buffer::WlBuffer);

impl Dispatch<ZwpInputPopupSurfaceV2, ()> for Heard {
    fn event(
        heard: &mut Self,
        _: &ZwpInputPopupSurfaceV2,
        event: zwp_input_popup_surface_v2::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let zwp_input_popup_surface_v2::Event::TextInputRectangle {
            x,
            y,
            width,
            height,
        } = event
        {
            heard
                .said
                .push(format!("text_input_rectangle({x}, {y}, {width}, {height})"));
        }
    }
}
