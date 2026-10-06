//! Behavior tests for `domicile-protocol`.
//!
//! Every message must round-trip through JSON, and tag and field names are
//! pinned because the JS client hard-codes them.

use domicile_protocol::{
    negotiate, AudioCard, AudioChoice, AudioDevice, AudioLevel, AudioStream, ChromeMessage,
    ClipboardEntry, CursorShape, DisplayInfo, DisplayTransform, FilePreview, HostMessage,
    Passphrase, PROTOCOL_VERSION,
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
    chrome_round_trip(&ChromeMessage::Unlock {
        passphrase: Passphrase::from("open sesame"),
    });
    chrome_round_trip(&ChromeMessage::Lock);
    chrome_round_trip(&ChromeMessage::SetBrightness { level: 0.25 });
    chrome_round_trip(&ChromeMessage::SetAudioVolume {
        id: "output:speakers".into(),
        volume: 0.5,
    });
    chrome_round_trip(&ChromeMessage::SetAudioMuted {
        id: "input:mic".into(),
        muted: true,
    });
    chrome_round_trip(&ChromeMessage::SetDefaultAudioDevice {
        id: "output:speakers".into(),
    });
    chrome_round_trip(&ChromeMessage::MoveAudioStream {
        id: "playback:42".into(),
        device: "output:headphones".into(),
    });
    chrome_round_trip(&ChromeMessage::SetAudioPort {
        id: "output:speakers".into(),
        port: "analog-output-headphones".into(),
    });
    chrome_round_trip(&ChromeMessage::SetAudioProfile {
        card: "alsa_card.pci".into(),
        profile: "output:hdmi-stereo".into(),
    });
}

/// A file search carries a query and no path, so a page cannot choose which
/// directory the compositor reads.
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

/// Applications are read by a shell library on the system calls, not asked of
/// the compositor.
#[test]
fn an_app_search_is_not_a_chrome_message() {
    assert!(serde_json::from_value::<ChromeMessage>(
        serde_json::json!({"type": "search_apps", "query": "fire"})
    )
    .is_err());
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

/// A preview request names one path; the compositor answers only for paths in
/// its index.
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

/// The preview's kind is flattened beside its path, the shape the engine
/// reads.
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

/// Audio tags are flattened beside the kind, and a missing tag is absent
/// rather than empty.
#[test]
fn an_audio_preview_is_flat_on_the_wire() {
    let v = serde_json::to_value(HostMessage::FilePreview {
        path: "Music/song.flac".into(),
        preview: FilePreview::Audio {
            title: Some("Song".into()),
            artist: None,
            album: None,
            duration: 61.5,
            cover: None,
        },
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({
            "type": "file_preview",
            "path": "Music/song.flac",
            "kind": "audio",
            "title": "Song",
            "duration": 61.5,
        })
    );
}

#[test]
fn host_messages_round_trip() {
    host_round_trip(&HostMessage::ShellConfig {
        keys: [("Return".to_string(), 28), ("l".to_string(), 25)].into(),
    });
}

/// Search results echo the query, list paths relative to home in display
/// order, and give the total match count.
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

/// Clipboard entries carry an id and a preview, never the full text, newest
/// first.
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

/// An empty clipboard history serializes as an empty list, not as nothing.
///
/// The history starts empty on every desktop start, so shells must receive it.
#[test]
fn a_desktop_nothing_was_copied_on_has_an_empty_clipboard() {
    let v = serde_json::to_value(HostMessage::Clipboard { entries: vec![] }).unwrap();
    assert_eq!(v["type"], "clipboard");
    assert_eq!(v["entries"], serde_json::json!([]));
}

/// Restoring a clipboard entry carries its id and no text, so a page cannot
/// write arbitrary clipboard contents.
#[test]
fn an_entry_is_handed_back_by_id_rather_than_by_its_text() {
    let v = serde_json::to_value(ChromeMessage::CopyClipboardEntry { entry: 7 }).unwrap();
    assert_eq!(v["type"], "copy_clipboard_entry");
    assert_eq!(v["entry"], 7);
}

/// Brightness is a fraction.
#[test]
fn the_brightness_is_a_fraction() {
    let v = serde_json::to_value(HostMessage::Brightness { level: 0.42 }).unwrap();
    assert_eq!(v["type"], "brightness");
    assert_eq!(v["level"], 0.42);
}

/// A brightness request is answered with [`HostMessage::Brightness`] to every
/// chrome once the backlight changes.
#[test]
fn setting_the_brightness_carries_the_level_and_nothing_else() {
    let sent = r#"{"type":"set_brightness","level":0.5}"#;
    assert_eq!(
        serde_json::from_str::<ChromeMessage>(sent).unwrap(),
        ChromeMessage::SetBrightness { level: 0.5 }
    );
}

/// Idle is sent as a state, not an edge, so a reloaded page can be told where
/// the desktop stands.
#[test]
fn whether_anybody_is_at_the_desk_is_a_state_rather_than_an_edge() {
    let dark = serde_json::to_value(HostMessage::Idle { idle: true }).unwrap();
    assert_eq!(dark["type"], "idle");
    assert_eq!(dark["idle"], true);

    let here = serde_json::to_value(HostMessage::Idle { idle: false }).unwrap();
    assert_eq!(here["type"], "idle");
    assert_eq!(
        here["idle"], false,
        "somebody coming back is the same message saying the other thing"
    );
}

/// Locked is sent as a state, so a reloaded page can be told `true` and show
/// its lock screen again.
#[test]
fn whether_the_desk_is_locked_is_a_state_rather_than_an_edge() {
    let shut = serde_json::to_value(HostMessage::Locked { locked: true }).unwrap();
    assert_eq!(shut["type"], "locked");
    assert_eq!(shut["locked"], true);

    let open = serde_json::to_value(HostMessage::Locked { locked: false }).unwrap();
    assert_eq!(open["type"], "locked");
    assert_eq!(
        open["locked"], false,
        "a desk that has just been opened is the same message saying the other thing"
    );
}

/// An unlock carries only the passphrase; the answer is
/// [`HostMessage::Locked`] to every chrome.
#[test]
fn an_unlock_carries_the_passphrase_and_nothing_else() {
    let v = serde_json::to_value(ChromeMessage::Unlock {
        passphrase: Passphrase::from("open sesame"),
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({"type": "unlock", "passphrase": "open sesame"})
    );
}

/// A lock request carries only its tag.
#[test]
fn a_lock_is_the_tag_and_nothing_else() {
    let v = serde_json::to_value(ChromeMessage::Lock).unwrap();
    assert_eq!(v, serde_json::json!({"type": "lock"}));
}

/// `Debug` output never contains the passphrase, so a `debug!` of a message
/// cannot leak it to the journal.
#[test]
fn a_passphrase_is_never_what_a_log_line_prints() {
    let secret = "correct horse battery staple";

    assert!(!format!("{:?}", Passphrase::from(secret)).contains(secret));

    // Including through the message, as a trace macro would format it.
    let message = ChromeMessage::Unlock {
        passphrase: Passphrase::from(secret),
    };
    assert!(
        !format!("{message:?}").contains(secret),
        "a message that prints its passphrase is one log line from the journal"
    );

    // The value itself is preserved.
    assert_eq!(Passphrase::from(secret).as_str(), secret);
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
    // Pin the wire shape as well as round-tripping, because shells read these
    // field names directly.
    let displays = HostMessage::Displays {
        displays: vec![
            DisplayInfo {
                name: "left".into(),
                position: [0, 0],
                size: [1920, 1080],
                scale: 1,
                mode: [1920, 1080],
                transform: DisplayTransform::Normal,
            },
            DisplayInfo {
                name: "right".into(),
                position: [1920, 0],
                size: [2560, 1440],
                scale: 2,
                mode: [5120, 2880],
                transform: DisplayTransform::Normal,
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
}

#[test]
fn a_monitor_on_its_side_says_so_and_says_what_it_scans_out() {
    // `size` is the logical box and `mode` the panel's pixels before rotation.
    // Neither derives from the other, because `scale` is the integer
    // `wl_output` scale: 3840x2160 rotated at density 1.2 is 1800x3200.
    // Transforms use the config file's kebab-case spelling.
    let v = serde_json::to_value(DisplayInfo {
        name: "drm-3".into(),
        position: [0, 0],
        size: [1800, 3200],
        scale: 2,
        mode: [3840, 2160],
        transform: DisplayTransform::Rotate270,
    })
    .unwrap();
    assert_eq!(v["size"], serde_json::json!([1800, 3200]));
    assert_eq!(v["mode"], serde_json::json!([3840, 2160]));
    assert_eq!(v["transform"], "rotate-270");
}

#[test]
fn a_display_that_predates_these_fields_still_reads() {
    // Older messages, such as fixtures, may lack these fields. They default to
    // an unrotated display.
    let old: DisplayInfo =
        serde_json::from_str(r#"{"name":"left","position":[0,0],"size":[1920,1080],"scale":1}"#)
            .expect("it reads");
    assert_eq!(old.transform, DisplayTransform::Normal);
    // `[0, 0]`, not the size: an unstated mode stays unstated.
    assert_eq!(old.mode, [0, 0]);
}

#[test]
fn which_turns_trade_a_monitors_width_for_its_height() {
    // Getting this backwards draws the desktop at the wrong scale rather than
    // failing.
    assert!(!DisplayTransform::Normal.swaps_axes());
    assert!(!DisplayTransform::Rotate180.swaps_axes());
    assert!(DisplayTransform::Rotate90.swaps_axes());
    assert!(DisplayTransform::Rotate270.swaps_axes());
}

#[test]
fn a_desktop_of_no_displays_is_a_message_rather_than_a_silence() {
    // The compositor always describes at least one display, but a `Host` with
    // no desktop described (unit tests, the `domicile` daemon) sends an empty
    // list. Check the wire form, since a round trip cannot tell `[]` from a
    // missing field.
    let v = serde_json::to_value(HostMessage::Displays { displays: vec![] }).unwrap();
    assert_eq!(v["type"], "displays");
    assert_eq!(v["displays"], serde_json::json!([]));
}

#[test]
fn wire_shape_is_pinned() {
    // The JS client depends on these exact strings.
    // An unknown size is `null`, not an absent key, matching how the chrome's
    // schema reads `title`.
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

/// `ROADMAP.md` states the version as a literal; this keeps it in sync with
/// [`PROTOCOL_VERSION`].
#[test]
fn the_roadmap_states_the_version_this_build_speaks() {
    // Reads a file outside the crate: this checks the repo's prose, not the
    // protocol.
    let roadmap = include_str!("../../../ROADMAP.md");
    let stated: Vec<&str> = roadmap
        .match_indices("`PROTOCOL_VERSION = ")
        .map(|(at, _)| &roadmap[at..])
        .collect();

    // Exactly one mention, so no stale copy can hide elsewhere in the
    // roadmap.
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

/// `resize_app` is not a message, and is rejected rather than ignored.
///
/// The engine reports window size through `xdg_toplevel.configure`. Rejection
/// makes the compositor log any chrome that still sends it.
#[test]
fn a_resize_the_chrome_no_longer_sends_is_not_a_message() {
    let line = r#"{"type":"resize_app","app_id":"term","size":[800.0,600.0]}"#;
    assert!(
        serde_json::from_str::<ChromeMessage>(line).is_err(),
        "the host still reads a resize the chrome no longer sends"
    );
}

/// The audio state lists every device and stream by the id the chrome's
/// requests use.
#[test]
fn the_audio_round_trips() {
    host_round_trip(&HostMessage::Audio {
        outputs: vec![AudioDevice {
            id: "output:speakers".into(),
            description: "Speakers".into(),
            volume: 0.5,
            muted: false,
            default: true,
            monitor: false,
            ports: vec![AudioChoice {
                name: "analog-output-speaker".into(),
                description: "Speakers".into(),
                available: true,
            }],
            port: Some("analog-output-speaker".into()),
        }],
        inputs: Vec::new(),
        playback: vec![AudioStream {
            id: "playback:42".into(),
            application: "Firefox".into(),
            title: Some("A song".into()),
            volume: 1.0,
            muted: false,
            device: Some("output:speakers".into()),
        }],
        recording: Vec::new(),
        cards: vec![AudioCard {
            id: "alsa_card.pci".into(),
            description: "Built-in Audio".into(),
            profiles: Vec::new(),
            profile: None,
        }],
    });
}

/// The exact JSON the SDK sends for each of the mixer's requests.
#[test]
fn the_mixers_requests_parse_as_the_sdk_sends_them() {
    let parse = |sent: &str| serde_json::from_str::<ChromeMessage>(sent).unwrap();
    assert_eq!(
        parse(r#"{"type":"set_audio_volume","id":"output:s","volume":0.5}"#),
        ChromeMessage::SetAudioVolume {
            id: "output:s".into(),
            volume: 0.5
        }
    );
    assert_eq!(
        parse(r#"{"type":"set_audio_muted","id":"input:m","muted":true}"#),
        ChromeMessage::SetAudioMuted {
            id: "input:m".into(),
            muted: true
        }
    );
    assert_eq!(
        parse(r#"{"type":"set_default_audio_device","id":"output:s"}"#),
        ChromeMessage::SetDefaultAudioDevice {
            id: "output:s".into()
        }
    );
    assert_eq!(
        parse(r#"{"type":"move_audio_stream","id":"playback:4","device":"output:s"}"#),
        ChromeMessage::MoveAudioStream {
            id: "playback:4".into(),
            device: "output:s".into()
        }
    );
    assert_eq!(
        parse(r#"{"type":"set_audio_port","id":"output:s","port":"p"}"#),
        ChromeMessage::SetAudioPort {
            id: "output:s".into(),
            port: "p".into()
        }
    );
    assert_eq!(
        parse(r#"{"type":"set_audio_profile","card":"c","profile":"off"}"#),
        ChromeMessage::SetAudioProfile {
            card: "c".into(),
            profile: "off".into()
        }
    );
}

/// Meters are requested by id and answered with each id's peak.
#[test]
fn the_meters_round_trip() {
    chrome_round_trip(&ChromeMessage::WatchAudioLevels {
        ids: vec!["output:speakers".into(), "input:mic".into()],
    });
    host_round_trip(&HostMessage::AudioLevels {
        levels: vec![AudioLevel {
            id: "output:speakers".into(),
            peak: 0.5,
        }],
    });
    assert_eq!(
        serde_json::from_str::<ChromeMessage>(r#"{"type":"watch_audio_levels","ids":["input:m"]}"#)
            .unwrap(),
        ChromeMessage::WatchAudioLevels {
            ids: vec!["input:m".into()]
        }
    );
}
