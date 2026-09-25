//! Behavior tests for `domicile-protocol`, written before the implementation.
//!
//! This crate defines the wire contract between the Rust host and the in-page
//! client (JS). Two things matter and are tested here:
//!  1. Every message round-trips through JSON unchanged.
//!  2. The on-the-wire shape is stable (the JS side hard-codes these strings),
//!     so we pin the tag/field names explicitly.

use domicile_protocol::{
    negotiate, ChromeMessage, ClipboardEntry, CursorShape, DisplayInfo, DisplayTransform,
    FilePreview, HostMessage, PROTOCOL_VERSION,
};

fn chrome_round_trip(msg: &ChromeMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let back: ChromeMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(*msg, back, "round-trip changed the message (json: {json})");
}

fn host_round_trip(msg: &HostMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let back: HostMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(*msg, back, "round-trip changed the message (json: {json})");
}

#[test]
fn chrome_messages_round_trip() {
    chrome_round_trip(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    });
    chrome_round_trip(&ChromeMessage::FocusApp {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::SetDevicePixelRatio { ratio: 1.5 });
    chrome_round_trip(&ChromeMessage::FocusChrome);
    chrome_round_trip(&ChromeMessage::CloseApp {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::Spawn {
        command: vec!["kitty".into(), "--hold".into()],
    });
    chrome_round_trip(&ChromeMessage::CopyClipboardEntry { entry: 7 });
    chrome_round_trip(&ChromeMessage::PointerMotion {
        app_id: "term".into(),
        x: 12.5,
        y: 3.0,
    });
    chrome_round_trip(&ChromeMessage::PointerLeave {
        app_id: "term".into(),
    });
    chrome_round_trip(&ChromeMessage::PointerButton {
        app_id: "term".into(),
        button: 0x110,
        pressed: true,
    });
    chrome_round_trip(&ChromeMessage::PointerAxis {
        app_id: "term".into(),
        dx: 0.0,
        dy: -15.0,
        v120_x: 0,
        v120_y: -120,
    });
    chrome_round_trip(&ChromeMessage::Key {
        app_id: "term".into(),
        keycode: 30,
        pressed: true,
    });
    chrome_round_trip(&ChromeMessage::SearchFiles {
        query: "plan".into(),
    });
    chrome_round_trip(&ChromeMessage::PreviewFile {
        path: "Notes/today.org".into(),
    });
}

/// The launcher's ask carries a query and no path, and that is the security
/// property.
///
/// A page cannot name a directory to enumerate, so this message is no route
/// out of the sandbox the shell is served in: it asks "what matches this",
/// and where the compositor looks for the answer is the compositor's.
#[test]
fn searching_for_something_to_open_names_no_directory() {
    let v = serde_json::to_value(ChromeMessage::SearchFiles {
        query: "plan".into(),
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({"type": "search_files", "query": "plan"})
    );
}

#[test]
fn spawn_wire_shape_is_pinned() {
    let v = serde_json::to_value(ChromeMessage::Spawn {
        command: vec!["kitty".into()],
    })
    .unwrap();
    assert_eq!(v["type"], "spawn");
    assert_eq!(v["command"][0], "kitty");
}

/// A preview names the one path it is about, as a search answered it.
///
/// Unlike `search_files` this does carry a path, and the compositor answers
/// only for one its index holds — so it reads nothing a search could not
/// already have named.
#[test]
fn asking_for_a_preview_names_the_path_a_search_answered() {
    let v = serde_json::to_value(ChromeMessage::PreviewFile {
        path: "Notes/today.org".into(),
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({"type": "preview_file", "path": "Notes/today.org"})
    );
}

/// The preview's kind sits beside its path rather than nested under it, so
/// the engine reads one flat object the way it reads every other message.
#[test]
fn a_preview_is_flat_on_the_wire() {
    let v = serde_json::to_value(HostMessage::FilePreview {
        path: "Notes".into(),
        preview: FilePreview::Directory {
            entries: vec!["2026/".into(), "today.org".into()],
        },
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({
            "type": "file_preview",
            "path": "Notes",
            "kind": "directory",
            "entries": ["2026/", "today.org"],
        })
    );
}

#[test]
fn host_messages_round_trip() {
    host_round_trip(&HostMessage::Welcome {
        protocol_version: PROTOCOL_VERSION,
    });
    host_round_trip(&HostMessage::AppAppeared {
        app_id: "term".into(),
        title: Some("Terminal".into()),
        size: Some([640.0, 480.0]),
    });
    // A client that has not committed yet, which is every client at the
    // moment this message goes out.
    host_round_trip(&HostMessage::AppAppeared {
        app_id: "x".into(),
        title: None,
        size: None,
    });
    host_round_trip(&HostMessage::AppTitled {
        app_id: "term".into(),
        title: Some("a terminal".into()),
    });
    // A client saying it has no name, which is `set_title("")` and not an
    // absent title: xdg-shell has no request that takes a name back.
    host_round_trip(&HostMessage::AppTitled {
        app_id: "term".into(),
        title: Some(String::new()),
    });
    host_round_trip(&HostMessage::AppResized {
        app_id: "term".into(),
        size: [800.0, 600.0],
    });
    host_round_trip(&HostMessage::Battery {
        charge: 0.42,
        charging: true,
    });
    host_round_trip(&HostMessage::AppClosed {
        app_id: "term".into(),
    });
    host_round_trip(&HostMessage::AppCursor {
        app_id: "term".into(),
        cursor: CursorShape::Text,
    });
    host_round_trip(&HostMessage::FoundFiles {
        query: "o".into(),
        files: vec!["Notes/today.org".into(), "src/".into()],
        matched: 2,
        indexing: false,
    });
    for preview in [
        FilePreview::Text {
            text: "* today".into(),
        },
        FilePreview::Directory {
            entries: vec!["2026/".into()],
        },
        FilePreview::Binary,
        FilePreview::Unreadable,
    ] {
        host_round_trip(&HostMessage::FilePreview {
            path: "Notes/today.org".into(),
            preview,
        });
    }
    host_round_trip(&HostMessage::Clipboard {
        entries: vec![ClipboardEntry {
            id: 3,
            preview: "ssh-rsa AAAA".into(),
        }],
    });
}

/// The answer is the query it answers, paths relative to the home directory
/// in the order they go on screen, and how many there were.
///
/// Relative because that is what a launcher shows — `Notes/today.org`, not
/// `/home/you/Notes/today.org`. The query comes back so a shell can tell the
/// answer to what is in its box from the answer to a keystroke ago.
#[test]
fn what_a_search_found_is_named_from_home() {
    let v = serde_json::to_value(HostMessage::FoundFiles {
        query: "o".into(),
        files: vec!["Notes/today.org".into(), "src/".into()],
        matched: 40,
        indexing: true,
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({
            "type": "found_files",
            "query": "o",
            "files": ["Notes/today.org", "src/"],
            "matched": 40,
            "indexing": true,
        })
    );
}

/// What was copied, in the shape a shell draws a row of it.
///
/// An id and a preview rather than the text, and the split is the whole shape
/// of this message: the compositor keeps the bytes and the page is told enough
/// to recognize them. A history of a hundred kilobytes broadcast on every
/// copy would be the desktop moving its clipboard through the shell, and the
/// shell has no use for it — what it does with a row is draw it and hand the
/// id back.
///
/// Newest first, which is the order a manager is read in: the last thing
/// copied is the one about to be wanted again.
#[test]
fn a_clipboard_row_is_an_id_and_enough_to_recognize_it_by() {
    let v = serde_json::to_value(HostMessage::Clipboard {
        entries: vec![
            ClipboardEntry {
                id: 3,
                preview: "the newest".into(),
            },
            ClipboardEntry {
                id: 1,
                preview: "the oldest".into(),
            },
        ],
    })
    .unwrap();
    assert_eq!(v["type"], "clipboard");
    assert_eq!(
        v["entries"],
        serde_json::json!([
            {"id": 3, "preview": "the newest"},
            {"id": 1, "preview": "the oldest"},
        ])
    );
}

/// A desktop nothing has been copied on yet says so, rather than saying
/// nothing.
///
/// The same distinction [`HostMessage::Displays`] draws, and it matters more
/// here: the history empties when the desktop restarts, so an empty list is
/// the ordinary state of a fresh session rather than an edge case. A shell
/// told nothing would wait forever for a first copy it has already been told
/// about.
#[test]
fn a_desktop_nothing_was_copied_on_has_an_empty_clipboard() {
    let v = serde_json::to_value(HostMessage::Clipboard { entries: vec![] }).unwrap();
    assert_eq!(v["type"], "clipboard");
    assert_eq!(v["entries"], serde_json::json!([]));
}

/// Handing an entry back names it by id and carries no text at all.
///
/// The asymmetry with every other chrome message is the point: a page that
/// could put arbitrary bytes on the seat's clipboard would be a page writing
/// the desktop's clipboard, and what a manager needs is to pick one of the
/// things already on it. An id that names nothing is a shell bug and the
/// compositor says so — see `domicile_host::clipboard::History::text`.
#[test]
fn an_entry_is_handed_back_by_id_rather_than_by_its_text() {
    let v = serde_json::to_value(ChromeMessage::CopyClipboardEntry { entry: 7 }).unwrap();
    assert_eq!(v["type"], "copy_clipboard_entry");
    assert_eq!(v["entry"], 7);
}

/// The charge, in the shape the bar draws it.
///
/// A fraction rather than a percentage, and that is not a style choice: the
/// bar rounds it to figures and fills a meter with it, and rounding once at
/// the end is what keeps the two from disagreeing. `charging` is whether a
/// lead is in rather than whether the cell is gaining — a full battery on AC
/// is charging by this message's reckoning, because what the bolt on the bar
/// says is that the machine is plugged in.
#[test]
fn the_charge_is_a_fraction_and_the_lead_is_a_flag() {
    let v = serde_json::to_value(HostMessage::Battery {
        charge: 0.42,
        charging: true,
    })
    .unwrap();
    assert_eq!(v["type"], "battery");
    assert_eq!(v["charge"], 0.42);
    assert_eq!(v["charging"], true);
}

/// A machine with no battery sends no message at all, so there is no "absent"
/// to serialize — which is why both fields are plain and neither is an
/// `Option`. An empty battery is a real reading and has to survive the wire
/// as one, the same way a home with no files does.
#[test]
fn an_empty_battery_is_a_reading_rather_than_a_silence() {
    let v = serde_json::to_value(HostMessage::Battery {
        charge: 0.0,
        charging: false,
    })
    .unwrap();
    assert_eq!(v["charge"], 0.0);
    assert_eq!(v["charging"], false);
}

/// The chrome assigns the cursor straight to CSS `cursor`, so every shape must
/// serialize to a valid CSS keyword.
#[test]
fn cursor_shapes_are_css_keywords() {
    let shape = |shape: CursorShape| serde_json::to_value(shape).unwrap();
    assert_eq!(shape(CursorShape::None), "none");
    assert_eq!(shape(CursorShape::Default), "default");
    assert_eq!(shape(CursorShape::Text), "text");
    assert_eq!(shape(CursorShape::NotAllowed), "not-allowed");
    assert_eq!(shape(CursorShape::NwseResize), "nwse-resize");
    assert_eq!(shape(CursorShape::ZoomIn), "zoom-in");
}

#[test]
fn the_desktop_is_described_to_the_chrome() {
    // Everything the chrome needs to lay a display out and address it. The
    // wire shape is pinned as well as round-tripped, because a shell reads
    // these field names directly.
    let displays = HostMessage::Displays {
        displays: vec![
            DisplayInfo {
                name: "left".into(),
                position: [0, 0],
                size: [1920, 1080],
                scale: 1,
                mode: [1920, 1080],
                transform: DisplayTransform::Normal,
                fills_the_window: false,
            },
            DisplayInfo {
                name: "right".into(),
                position: [1920, 0],
                size: [2560, 1440],
                scale: 2,
                mode: [5120, 2880],
                transform: DisplayTransform::Normal,
                fills_the_window: false,
            },
        ],
    };
    host_round_trip(&displays);

    let v = serde_json::to_value(displays).unwrap();
    assert_eq!(v["type"], "displays");
    assert_eq!(v["displays"][0]["name"], "left");
    assert_eq!(v["displays"][0]["position"], serde_json::json!([0, 0]));
    assert_eq!(v["displays"][1]["name"], "right");
    assert_eq!(v["displays"][1]["position"][0], 1920);
    assert_eq!(v["displays"][1]["size"][1], 1440);
    assert_eq!(v["displays"][1]["scale"], 2);
    assert_eq!(v["displays"][1]["mode"], serde_json::json!([5120, 2880]));
    assert_eq!(v["displays"][1]["transform"], "normal");
    assert_eq!(v["displays"][1]["fills_the_window"], false);
}

#[test]
fn a_monitor_on_its_side_says_so_and_says_what_it_scans_out() {
    // The three fields a page turns into a CSS transform. `size` is the box
    // the shell lays out in, `mode` is the pixels the panel has, and the two
    // are not each other's units: 3840x2160 stood on its side at density 1.2
    // is a 1800x3200 box. Nothing can be derived from the other two --
    // `scale` on the wire is the INTEGER `wl_output` one, so 1800 times 2 is
    // not 2160 and never was.
    //
    // Kebab-case, because that is what the config file writes and there is no
    // second spelling of a transform anywhere in this system.
    let v = serde_json::to_value(DisplayInfo {
        name: "drm-3".into(),
        position: [0, 0],
        size: [1800, 3200],
        scale: 2,
        mode: [3840, 2160],
        transform: DisplayTransform::Rotate270,
        fills_the_window: true,
    })
    .unwrap();
    assert_eq!(v["size"], serde_json::json!([1800, 3200]));
    assert_eq!(v["mode"], serde_json::json!([3840, 2160]));
    assert_eq!(v["transform"], "rotate-270");
    assert_eq!(v["fills_the_window"], true);
}

#[test]
fn a_display_that_predates_these_fields_still_reads() {
    // Not a compatibility floor -- nothing can complete a handshake and then
    // send a `displays` without them. It is that a captured session, a
    // hand-written line, or a fixture from before the fork scanned anything
    // out is still a thing this crate reads, and the answer it gives for the
    // three is the desktop that had no notion of them: lying down, and not
    // anybody's viewport.
    let old: DisplayInfo =
        serde_json::from_str(r#"{"name":"left","position":[0,0],"size":[1920,1080],"scale":1}"#)
            .expect("it reads");
    assert_eq!(old.transform, DisplayTransform::Normal);
    assert!(!old.fills_the_window);
    // `[0, 0]` and not the size: a mode nobody stated is not a mode, and
    // `fills_the_window` is false, which is the field that decides whether
    // anybody divides by it.
    assert_eq!(old.mode, [0, 0]);
}

#[test]
fn which_turns_trade_a_monitors_width_for_its_height() {
    // The one thing a transform changes about arithmetic. A page needs it to
    // know which way `mode` divides into `size`, and getting it backwards is a
    // desktop drawn at the wrong scale rather than an error.
    assert!(!DisplayTransform::Normal.swaps_axes());
    assert!(!DisplayTransform::Rotate180.swaps_axes());
    assert!(DisplayTransform::Rotate90.swaps_axes());
    assert!(DisplayTransform::Rotate270.swaps_axes());
}

#[test]
fn a_desktop_of_no_displays_is_a_message_rather_than_a_silence() {
    // A desktop with no screens on it is an answer the chrome has to be able
    // to receive, not the absence of one. The compositor never sends it — it
    // describes at least one output, and the window-following case is a
    // display named `domicile-0` rather than an empty list — but a `Host`
    // nobody has described a desktop to does, and the `domicile` daemon is
    // one. "Told nothing" and "not told" are different states, and the shape
    // has to survive the wire for a chrome to tell them apart.
    // Asserted on the wire rather than through a round trip, which cannot see
    // the difference: an empty `Vec` that serializes to nothing at all and one
    // that serializes to `[]` both come back empty, and only the second is a
    // desktop the chrome can parse.
    let v = serde_json::to_value(HostMessage::Displays { displays: vec![] }).unwrap();
    assert_eq!(v["type"], "displays");
    assert_eq!(v["displays"], serde_json::json!([]));
}

#[test]
fn wire_shape_is_pinned() {
    // The JS client depends on these exact strings — lock them.
    // A size the client has not said is `null` on the wire rather than an
    // absent key, which is the shape the chrome's schema parses: it reads
    // `size` the way it already reads `title`, and both arrive as JSON null.
    let v = serde_json::to_value(HostMessage::AppAppeared {
        app_id: "term".into(),
        title: None,
        size: None,
    })
    .unwrap();
    assert!(v["size"].is_null());

    let v = serde_json::to_value(HostMessage::AppCursor {
        app_id: "term".into(),
        cursor: CursorShape::Pointer,
    })
    .unwrap();
    assert_eq!(v["type"], "app_cursor");
    assert_eq!(v["cursor"], "pointer");
}

#[test]
fn version_negotiation_accepts_matching_version() {
    assert_eq!(negotiate(PROTOCOL_VERSION).unwrap(), PROTOCOL_VERSION);
}

#[test]
fn version_negotiation_rejects_mismatch() {
    assert!(negotiate(PROTOCOL_VERSION + 1).is_err());
}

/// `ROADMAP.md` states the version as a literal, and this pins it.
///
/// Nothing pinned it before, and the habit that produced is worth naming
/// without counting, since any count includes the commit doing the counting.
/// The line spent most of its life stale: it was caught up in batches long
/// after the fact, once by a commit that bumped no version at all, and bumps
/// that edited `ROADMAP.md` in the same breath still walked past it. So
/// "remember to update the roadmap" was never the missing habit — a number
/// written down in prose is a copy of the constant, and it belongs to the
/// crate that owns the constant.
#[test]
fn the_roadmap_states_the_version_this_build_speaks() {
    // The path climbs out of the crate, which the crate itself never does. A
    // test that reads a repo file is not the portable description of the
    // protocol that `lib.rs` is; it is the check that the repo's prose about
    // it is true, and there is nowhere else for that to live.
    let roadmap = include_str!("../../../ROADMAP.md");
    let stated: Vec<&str> = roadmap
        .match_indices("`PROTOCOL_VERSION = ")
        .map(|(at, _)| &roadmap[at..])
        .collect();

    // Every mention, not merely one that agrees: a roadmap that says 13 in one
    // place and 14 in another satisfies "contains the right number" and is
    // still wrong wherever a reader happens to look.
    assert_eq!(
        stated.len(),
        1,
        "ROADMAP.md states the protocol version {} times; it is one line",
        stated.len()
    );
    assert!(
        stated[0].starts_with(&format!("`PROTOCOL_VERSION = {PROTOCOL_VERSION}`")),
        "ROADMAP.md does not say `PROTOCOL_VERSION = {PROTOCOL_VERSION}`; a bump left it behind"
    );
}

/// A window's box is the engine's to state, so the chrome has stopped saying
/// it and this crate has stopped listening.
///
/// Refused rather than ignored, which is the whole of the change on the wire:
/// the tag match is exact, so a chrome still sending `resize_app` does not
/// quietly configure nothing — the compositor logs the line it could not read
/// and the drift is visible. The other half of it is that an `<app>`'s layout
/// box already *is* the `xdg_toplevel.configure`, reported natively, so a
/// second opinion about the same box is not a message that went missing.
#[test]
fn a_resize_the_chrome_no_longer_sends_is_not_a_message() {
    let line = r#"{"type":"resize_app","app_id":"term","size":[800.0,600.0]}"#;
    assert!(
        serde_json::from_str::<ChromeMessage>(line).is_err(),
        "the host still reads a resize the chrome no longer sends"
    );
}
