//! Wire shapes for portal dialogs.
//!
//! Pinned as JSON because the SDK and the engine's relay hard-code them. See
//! `docs/PORTALS.md`.

use std::collections::BTreeMap;

use domicile_protocol::{
    AccessDialog, AccountDialog, AppChooserDialog, BoundShortcut, Captured, Capturing,
    CapturingKind, CastPick, CastSource, ChosenTrigger, ChromeMessage, DeskRect, Devices,
    FileChoice, FileChoiceOption, FileChooserAnswer, FileChooserDialog, FileChooserMode,
    FileFilter, FrozenDesk, HostMessage, Inhibited, Inhibition, InputCaptureDialog, LauncherDialog,
    LauncherType, PortalAnswer, PortalKind, PortalRequest, PortalWallpaper, ProposedShortcut,
    RemoteDesktopDialog, ScreenCastDialog, ShortcutsDialog, ShotArea, ShotRect, ShotWindow,
    TakenChord, UsbDevice, UsbDialog, WallpaperDialog, WallpaperTarget,
};

fn access() -> PortalRequest {
    PortalRequest {
        id: 1,
        app_id: "org.example.App".into(),
        parent_app_id: Some("app-3".into()),
        kind: PortalKind::Access(AccessDialog {
            title: "Use the camera?".into(),
            subtitle: "Example wants to see you".into(),
            body: "".into(),
            grant_label: Some("Allow".into()),
            deny_label: None,
        }),
    }
}

#[test]
fn a_request_carries_its_kind_beside_an_untyped_body() {
    let written = serde_json::to_string(&HostMessage::PortalRequests {
        items: vec![access()],
        capturing: Vec::new(),
        shortcuts: Vec::new(),
        wallpaper: PortalWallpaper::default(),
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"type":"portal_requests","items":[{"id":1,"app_id":"org.example.App","parent_app_id":"app-3","kind":"access","body":{"title":"Use the camera?","subtitle":"Example wants to see you","body":"","grant_label":"Allow"}}],"capturing":[]}"#
    );
}

#[test]
fn an_inhibitor_names_what_it_holds_off() {
    let written = serde_json::to_string(&PortalRequest {
        id: 2,
        app_id: "org.example.Editor".into(),
        parent_app_id: None,
        kind: PortalKind::Inhibit(Inhibition {
            what: vec![Inhibited::Logout, Inhibited::UserSwitch, Inhibited::Suspend],
            reason: Some("Unsaved changes".into()),
        }),
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"id":2,"app_id":"org.example.Editor","kind":"inhibit","body":{"what":["logout","user_switch","suspend"],"reason":"Unsaved changes"}}"#
    );
}

#[test]
fn a_request_with_no_parent_window_reads_back() {
    let request = PortalRequest {
        parent_app_id: None,
        ..access()
    };
    let written = serde_json::to_string(&request).expect("it serializes");

    assert!(!written.contains("parent_app_id"), "{written}");
    assert_eq!(
        serde_json::from_str::<PortalRequest>(&written).expect("it parses"),
        request
    );
}

#[test]
fn an_account_request_carries_what_is_shared_and_its_reason_when_given_one() {
    let asked = |reason: Option<&str>, image: Option<&str>| {
        serde_json::to_string(&PortalKind::Account(AccountDialog {
            reason: reason.map(String::from),
            name: "Ada Lovelace".into(),
            image: image.map(String::from),
        }))
        .expect("it serializes")
    };

    assert_eq!(
        asked(
            Some("To sign you in"),
            Some("/var/lib/AccountsService/icons/ada")
        ),
        r#"{"kind":"account","body":{"reason":"To sign you in","name":"Ada Lovelace","image":"/var/lib/AccountsService/icons/ada"}}"#
    );
    assert_eq!(
        asked(None, None),
        r#"{"kind":"account","body":{"name":"Ada Lovelace"}}"#
    );
}

#[test]
fn every_answer_the_sdk_sends_parses() {
    for (sent, answer) in [
        (r#"{"kind":"access"}"#, PortalAnswer::Access),
        (r#"{"kind":"canceled"}"#, PortalAnswer::Canceled),
        (r#"{"kind":"refused"}"#, PortalAnswer::Refused),
    ] {
        let line = format!(r#"{{"type":"answer_portal_request","id":4,"answer":{sent}}}"#);
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(&line).expect("the SDK's own wire form"),
            ChromeMessage::AnswerPortalRequest { id: 4, answer },
            "{sent}"
        );
    }
}

#[test]
fn a_file_chooser_carries_what_the_picker_needs() {
    let request = PortalRequest {
        id: 2,
        app_id: "org.example.Editor".into(),
        parent_app_id: None,
        kind: PortalKind::FileChooser(FileChooserDialog {
            mode: FileChooserMode::Save,
            title: "Save As".into(),
            accept_label: Some("Keep".into()),
            multiple: false,
            directory: false,
            filters: vec![FileFilter {
                name: "Text".into(),
                extensions: vec!["txt".into()],
            }],
            current_filter: Some(0),
            current_folder: Some("/home/me/Documents".into()),
            home: "/home/me".into(),
            current_name: Some("notes.txt".into()),
            files: Vec::new(),
            choices: vec![FileChoice {
                id: "encoding".into(),
                label: "Encoding".into(),
                options: vec![FileChoiceOption {
                    id: "utf8".into(),
                    label: "UTF-8".into(),
                }],
                initial: "utf8".into(),
            }],
        }),
    };

    assert_eq!(
        serde_json::to_string(&request).expect("it serializes"),
        r#"{"id":2,"app_id":"org.example.Editor","kind":"file_chooser","body":{"mode":"save","title":"Save As","accept_label":"Keep","multiple":false,"directory":false,"filters":[{"name":"Text","extensions":["txt"]}],"current_filter":0,"current_folder":"/home/me/Documents","home":"/home/me","current_name":"notes.txt","files":[],"choices":[{"id":"encoding","label":"Encoding","options":[{"id":"utf8","label":"UTF-8"}],"initial":"utf8"}]}}"#
    );
}

#[test]
fn a_chosen_file_reads_back_with_its_choices_and_filter() {
    let line = r#"{"type":"answer_portal_request","id":4,"answer":{"kind":"file_chooser","paths":["/home/me/a b.txt"],"choices":{"encoding":"utf8"},"current_filter":1}}"#;

    assert_eq!(
        serde_json::from_str::<ChromeMessage>(line).expect("the SDK's own wire form"),
        ChromeMessage::AnswerPortalRequest {
            id: 4,
            answer: PortalAnswer::FileChooser(FileChooserAnswer {
                paths: vec!["/home/me/a b.txt".into()],
                choices: BTreeMap::from([("encoding".into(), "utf8".into())]),
                current_filter: Some(1),
            }),
        }
    );
}

#[test]
fn an_answer_of_no_kind_is_not_a_message() {
    let line = r#"{"type":"answer_portal_request","id":4,"answer":{"kind":"maybe"}}"#;

    assert!(serde_json::from_str::<ChromeMessage>(line).is_err());
}

#[test]
fn a_dismissal_is_response_one_and_a_refusal_two() {
    assert_eq!(PortalAnswer::Access.response(), 0);
    assert_eq!(PortalAnswer::Canceled.response(), 1);
    assert_eq!(PortalAnswer::Refused.response(), 2);
}

fn app_chooser() -> AppChooserDialog {
    AppChooserDialog {
        choices: vec!["org.gnome.Evince".into(), "firefox".into()],
        last_choice: Some("firefox".into()),
        content_type: Some("application/pdf".into()),
        uri: None,
        filename: Some("report.pdf".into()),
    }
}

#[test]
fn an_app_chooser_names_its_candidates_by_desktop_file_id() {
    let written =
        serde_json::to_string(&PortalKind::AppChooser(app_chooser())).expect("it serializes");

    assert_eq!(
        written,
        r#"{"kind":"app_chooser","body":{"choices":["org.gnome.Evince","firefox"],"last_choice":"firefox","content_type":"application/pdf","filename":"report.pdf"}}"#
    );
}

#[test]
fn a_chosen_application_is_a_success() {
    let line = r#"{"type":"answer_portal_request","id":4,"answer":{"kind":"app_chooser","choice":"firefox"}}"#;
    let answer = PortalAnswer::AppChooser {
        choice: "firefox".into(),
    };

    assert_eq!(
        serde_json::from_str::<ChromeMessage>(line).expect("the SDK's own wire form"),
        ChromeMessage::AnswerPortalRequest {
            id: 4,
            answer: answer.clone()
        }
    );
    assert_eq!(answer.response(), 0);
}

#[test]
fn a_request_takes_only_answers_of_its_own_kind() {
    let chooser = PortalKind::AppChooser(app_chooser());
    let access = PortalKind::Access(AccessDialog {
        title: String::new(),
        subtitle: String::new(),
        body: String::new(),
        grant_label: None,
        deny_label: None,
    });
    let chose = |choice: &str| PortalAnswer::AppChooser {
        choice: choice.into(),
    };

    assert!(chooser.accepts(&chose("firefox")));
    assert!(!chooser.accepts(&chose("evil")), "not among the choices");
    assert!(!chooser.accepts(&PortalAnswer::Access));
    assert!(access.accepts(&PortalAnswer::Access));
    assert!(!access.accepts(&chose("firefox")));
    let files = PortalKind::FileChooser(FileChooserDialog {
        mode: FileChooserMode::Open,
        title: String::new(),
        accept_label: None,
        multiple: false,
        directory: false,
        filters: Vec::new(),
        current_filter: None,
        current_folder: None,
        home: "/home/me".into(),
        current_name: None,
        files: Vec::new(),
        choices: Vec::new(),
    });
    let chosen_file = PortalAnswer::FileChooser(FileChooserAnswer {
        paths: vec!["/etc/passwd".into()],
        choices: BTreeMap::new(),
        current_filter: None,
    });
    assert!(files.accepts(&chosen_file));
    assert!(!files.accepts(&PortalAnswer::Access));
    assert!(!access.accepts(&chosen_file), "a file grants no access");
    assert!(!chooser.accepts(&chosen_file));
    let account = PortalKind::Account(AccountDialog {
        reason: None,
        name: "Ada Lovelace".into(),
        image: None,
    });
    assert!(account.accepts(&PortalAnswer::Access));
    assert!(!account.accepts(&chose("firefox")));
    assert!(!account.accepts(&chosen_file));
    for kind in [&chooser, &access, &files, &account] {
        assert!(kind.accepts(&PortalAnswer::Canceled));
        assert!(kind.accepts(&PortalAnswer::Refused));
    }
}

fn every_device() -> Devices {
    Devices {
        keyboard: true,
        pointer: true,
        touchscreen: true,
    }
}

#[test]
fn a_remote_desktop_grant_asks_for_devices_and_the_clipboard() {
    let written = serde_json::to_string(&PortalRequest {
        id: 2,
        app_id: "org.example.Remote".into(),
        parent_app_id: None,
        kind: PortalKind::RemoteDesktop(RemoteDesktopDialog {
            devices: Devices {
                keyboard: true,
                pointer: true,
                touchscreen: false,
            },
            clipboard: true,
        }),
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"id":2,"app_id":"org.example.Remote","kind":"remote_desktop","body":{"devices":{"keyboard":true,"pointer":true,"touchscreen":false},"clipboard":true}}"#
    );
}

#[test]
fn an_input_capture_grant_asks_for_devices() {
    let written = serde_json::to_string(&PortalKind::InputCapture(InputCaptureDialog {
        devices: every_device(),
    }))
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"kind":"input_capture","body":{"devices":{"keyboard":true,"pointer":true,"touchscreen":true}}}"#
    );
}

#[test]
fn the_answers_to_input_grants_parse() {
    for (sent, answer) in [
        (
            r#"{"kind":"remote_desktop","devices":{"keyboard":true,"pointer":false,"touchscreen":true},"clipboard":false}"#,
            PortalAnswer::RemoteDesktop {
                devices: Devices {
                    keyboard: true,
                    pointer: false,
                    touchscreen: true,
                },
                clipboard: false,
            },
        ),
        (r#"{"kind":"input_capture"}"#, PortalAnswer::InputCapture),
        (r#"{"kind":"stop"}"#, PortalAnswer::Stop),
    ] {
        assert_eq!(
            serde_json::from_str::<PortalAnswer>(sent).expect("the SDK's own wire form"),
            answer,
            "{sent}"
        );
    }
    assert_eq!(
        PortalAnswer::RemoteDesktop {
            devices: every_device(),
            clipboard: true,
        }
        .response(),
        0
    );
    assert_eq!(PortalAnswer::InputCapture.response(), 0);
}

#[test]
fn the_push_lists_what_is_being_controlled_beside_the_dialogs() {
    let written = serde_json::to_string(&HostMessage::PortalRequests {
        items: Vec::new(),
        capturing: vec![
            Capturing {
                id: 3,
                app_id: "org.example.Remote".into(),
                kind: CapturingKind::RemoteDesktop {
                    devices: every_device(),
                    clipboard: true,
                },
            },
            Capturing {
                id: 4,
                app_id: "org.example.Barrier".into(),
                kind: CapturingKind::InputCapture {
                    devices: Devices {
                        keyboard: true,
                        pointer: true,
                        touchscreen: false,
                    },
                },
            },
        ],
        shortcuts: Vec::new(),
        wallpaper: PortalWallpaper::default(),
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"type":"portal_requests","items":[],"capturing":[{"id":3,"app_id":"org.example.Remote","kind":"remote_desktop","body":{"devices":{"keyboard":true,"pointer":true,"touchscreen":true},"clipboard":true}},{"id":4,"app_id":"org.example.Barrier","kind":"input_capture","body":{"devices":{"keyboard":true,"pointer":true,"touchscreen":false}}}]}"#
    );
}

#[test]
fn a_push_without_sessions_reads_as_none() {
    let line = r#"{"type":"portal_requests","items":[]}"#;

    assert_eq!(
        serde_json::from_str::<HostMessage>(line).expect("it parses"),
        HostMessage::PortalRequests {
            items: Vec::new(),
            capturing: Vec::new(),
            shortcuts: Vec::new(),
            wallpaper: PortalWallpaper::default(),
        }
    );
}

#[test]
fn an_input_grant_takes_only_its_own_answer() {
    let remote = PortalKind::RemoteDesktop(RemoteDesktopDialog {
        devices: every_device(),
        clipboard: false,
    });
    let capture = PortalKind::InputCapture(InputCaptureDialog {
        devices: every_device(),
    });
    let granted = PortalAnswer::RemoteDesktop {
        devices: every_device(),
        clipboard: false,
    };

    assert!(remote.accepts(&granted));
    assert!(!remote.accepts(&PortalAnswer::InputCapture));
    assert!(capture.accepts(&PortalAnswer::InputCapture));
    assert!(!capture.accepts(&granted));
    assert!(!capture.accepts(&PortalAnswer::Access));
    for kind in [&remote, &capture] {
        assert!(!kind.accepts(&PortalAnswer::Stop), "a stop is for sessions");
    }
}

#[test]
fn a_shortcuts_review_carries_each_proposal_and_the_chords_others_hold() {
    let written = serde_json::to_string(&PortalKind::GlobalShortcuts(ShortcutsDialog {
        shortcuts: vec![
            ProposedShortcut {
                id: "talk".into(),
                description: "Push to talk".into(),
                trigger: Some("Ctrl+Alt+t".into()),
            },
            ProposedShortcut {
                id: "mute".into(),
                description: "Mute".into(),
                trigger: None,
            },
        ],
        taken: vec![TakenChord {
            chord: "Ctrl+Alt+m".into(),
            app_id: "org.example.Other".into(),
        }],
    }))
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"kind":"global_shortcuts","body":{"shortcuts":[{"id":"talk","description":"Push to talk","trigger":"Ctrl+Alt+t"},{"id":"mute","description":"Mute"}],"taken":[{"chord":"Ctrl+Alt+m","app_id":"org.example.Other"}]}}"#
    );
}

#[test]
fn bound_shortcuts_ride_beside_the_dialogs_and_are_absent_when_none() {
    let bound = HostMessage::PortalRequests {
        items: Vec::new(),
        capturing: Vec::new(),
        shortcuts: vec![BoundShortcut {
            id: 3,
            app_id: "org.example.App".into(),
            chord: "Ctrl+Alt+t".into(),
        }],
        wallpaper: PortalWallpaper::default(),
    };
    let none = HostMessage::PortalRequests {
        items: Vec::new(),
        capturing: Vec::new(),
        shortcuts: Vec::new(),
        wallpaper: PortalWallpaper::default(),
    };

    assert_eq!(
        serde_json::to_string(&bound).expect("it serializes"),
        r#"{"type":"portal_requests","items":[],"capturing":[],"shortcuts":[{"id":3,"app_id":"org.example.App","chord":"Ctrl+Alt+t"}]}"#
    );
    assert_eq!(
        serde_json::to_string(&none).expect("it serializes"),
        r#"{"type":"portal_requests","items":[],"capturing":[]}"#
    );
}

#[test]
fn the_shortcut_answers_the_sdk_sends_parse() {
    for (sent, answer) in [
        (
            r#"{"kind":"global_shortcuts","triggers":[{"id":"talk","trigger":"Ctrl+Alt+t"},{"id":"mute"}]}"#,
            PortalAnswer::GlobalShortcuts {
                triggers: vec![
                    ChosenTrigger {
                        id: "talk".into(),
                        trigger: Some("Ctrl+Alt+t".into()),
                    },
                    ChosenTrigger {
                        id: "mute".into(),
                        trigger: None,
                    },
                ],
            },
        ),
        (r#"{"kind":"pressed"}"#, PortalAnswer::Pressed),
        (r#"{"kind":"released"}"#, PortalAnswer::Released),
    ] {
        let line = format!(r#"{{"type":"answer_portal_request","id":4,"answer":{sent}}}"#);
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(&line).expect("the SDK's own wire form"),
            ChromeMessage::AnswerPortalRequest { id: 4, answer },
            "{sent}"
        );
    }
}

#[test]
fn chosen_triggers_are_a_success_and_a_press_answers_no_dialog() {
    let review = PortalKind::GlobalShortcuts(ShortcutsDialog {
        shortcuts: Vec::new(),
        taken: Vec::new(),
    });
    let chosen = PortalAnswer::GlobalShortcuts {
        triggers: Vec::new(),
    };

    assert_eq!(chosen.response(), 0);
    assert_eq!(PortalAnswer::Pressed.response(), 2);
    assert_eq!(PortalAnswer::Released.response(), 2);
    assert!(review.accepts(&chosen));
    assert!(!review.accepts(&PortalAnswer::Access));
    assert!(
        !review.accepts(&PortalAnswer::Pressed),
        "a press answers no request"
    );
}

#[test]
fn a_wallpaper_request_names_the_picture_and_where_it_goes() {
    let written = serde_json::to_string(&PortalRequest {
        id: 2,
        app_id: "org.example.Photos".into(),
        parent_app_id: None,
        kind: PortalKind::Wallpaper(WallpaperDialog {
            path: "/home/u/Pictures/sky.jpg".into(),
            set_on: WallpaperTarget::Both,
        }),
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"id":2,"app_id":"org.example.Photos","kind":"wallpaper","body":{"path":"/home/u/Pictures/sky.jpg","set_on":"both"}}"#
    );
}

#[test]
fn a_wallpaper_preview_is_allowed_only_as_access() {
    let preview = PortalKind::Wallpaper(WallpaperDialog {
        path: "/home/u/Pictures/sky.jpg".into(),
        set_on: WallpaperTarget::Background,
    });

    assert!(preview.accepts(&PortalAnswer::Access));
    assert!(!preview.accepts(&PortalAnswer::AppChooser {
        choice: "firefox".into()
    }));
}

#[test]
fn the_requests_carry_the_wallpaper_portals_set() {
    let written = serde_json::to_string(&HostMessage::PortalRequests {
        items: vec![],
        capturing: vec![],
        shortcuts: vec![],
        wallpaper: PortalWallpaper {
            background: Some("/state/background-1.jpg".into()),
            lockscreen: None,
        },
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"type":"portal_requests","items":[],"capturing":[],"wallpaper":{"background":"/state/background-1.jpg"}}"#
    );
}

#[test]
fn no_wallpaper_set_is_left_off_the_wire() {
    let written = serde_json::to_string(&HostMessage::PortalRequests {
        items: vec![],
        capturing: vec![],
        shortcuts: vec![],
        wallpaper: PortalWallpaper::default(),
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"type":"portal_requests","items":[],"capturing":[]}"#
    );
}

fn launcher(editable_name: bool) -> PortalKind {
    PortalKind::DynamicLauncher(LauncherDialog {
        name: "Mail".into(),
        icon: Some("data:image/png;base64,iVBORw==".into()),
        launcher_type: LauncherType::Webapp,
        target: Some("https://mail.example.com".into()),
        editable_name,
    })
}

#[test]
fn a_launcher_install_shows_its_name_icon_and_address() {
    let written = serde_json::to_string(&launcher(true)).expect("it serializes");

    assert_eq!(
        written,
        r#"{"kind":"dynamic_launcher","body":{"name":"Mail","icon":"data:image/png;base64,iVBORw==","launcher_type":"webapp","target":"https://mail.example.com","editable_name":true}}"#
    );
}

#[test]
fn a_launcher_takes_the_name_the_user_gave_it() {
    let line = r#"{"type":"answer_portal_request","id":4,"answer":{"kind":"dynamic_launcher","name":"Work mail"}}"#;
    let named = |name: &str| PortalAnswer::DynamicLauncher { name: name.into() };

    assert_eq!(
        serde_json::from_str::<ChromeMessage>(line).expect("the SDK's own wire form"),
        ChromeMessage::AnswerPortalRequest {
            id: 4,
            answer: named("Work mail"),
        }
    );
    assert!(launcher(true).accepts(&named("Work mail")));
    assert!(
        !launcher(true).accepts(&named("")),
        "a launcher needs a name"
    );
    assert!(
        !launcher(false).accepts(&named("Work mail")),
        "not editable"
    );
    assert!(launcher(false).accepts(&named("Mail")));
    assert!(!launcher(true).accepts(&PortalAnswer::Access));
}

#[test]
fn a_usb_grant_lists_each_device_and_is_allowed_whole() {
    let usb = PortalKind::Usb(UsbDialog {
        devices: vec![UsbDevice {
            id: "dev-1".into(),
            vendor: Some("Yubico".into()),
            product: None,
            writable: true,
        }],
    });

    assert_eq!(
        serde_json::to_string(&usb).expect("it serializes"),
        r#"{"kind":"usb","body":{"devices":[{"id":"dev-1","vendor":"Yubico","writable":true}]}}"#
    );
    assert!(usb.accepts(&PortalAnswer::Access));
    assert!(!usb.accepts(&PortalAnswer::DynamicLauncher { name: "x".into() }));
}

#[test]
fn a_screen_cast_request_lists_the_sources_to_pick_from() {
    let request = PortalRequest {
        id: 2,
        app_id: "us.zoom.Zoom".into(),
        parent_app_id: None,
        kind: PortalKind::ScreenCast(ScreenCastDialog {
            multiple: false,
            sources: vec![
                CastSource::Window {
                    id: "app-3".into(),
                    title: "Notes".into(),
                    app_id: "org.gnome.TextEditor".into(),
                },
                CastSource::Monitor {
                    name: "drm-1".into(),
                    description: "Dell Inc. DELL U3219Q".into(),
                    size: (1920, 1080),
                },
            ],
            region: true,
        }),
    };

    assert_eq!(
        serde_json::to_string(&request).expect("it serializes"),
        r#"{"id":2,"app_id":"us.zoom.Zoom","kind":"screen_cast","body":{"multiple":false,"sources":[{"type":"window","id":"app-3","title":"Notes","app_id":"org.gnome.TextEditor"},{"type":"monitor","name":"drm-1","description":"Dell Inc. DELL U3219Q","size":[1920,1080]}],"region":true}}"#
    );
}

#[test]
fn the_shell_answers_a_screen_cast_with_the_sources_picked() {
    let line = r#"{"type":"answer_portal_request","id":2,"answer":{"kind":"screen_cast","sources":[{"type":"window","id":"app-3"},{"type":"monitor","name":"drm-1"},{"type":"region","position":[10,-20],"size":[300,200]}]}}"#;
    let answer = PortalAnswer::ScreenCast {
        sources: vec![
            CastPick::Window { id: "app-3".into() },
            CastPick::Monitor {
                name: "drm-1".into(),
            },
            CastPick::Region {
                position: (10, -20),
                size: (300, 200),
            },
        ],
    };

    assert_eq!(
        serde_json::from_str::<ChromeMessage>(line).expect("the SDK's own wire form"),
        ChromeMessage::AnswerPortalRequest {
            id: 2,
            answer: answer.clone(),
        }
    );
    let cast = PortalKind::ScreenCast(ScreenCastDialog {
        multiple: false,
        sources: vec![],
        region: false,
    });
    assert!(cast.accepts(&answer));
    assert!(!cast.accepts(&PortalAnswer::Access));
    assert!(!cast.accepts(&PortalAnswer::Stop), "a stop is for sessions");
}

#[test]
fn a_running_screen_cast_says_what_it_records() {
    let written = serde_json::to_string(&Capturing {
        id: 5,
        app_id: "us.zoom.Zoom".into(),
        kind: CapturingKind::ScreenCast {
            sources: vec![
                Captured::Window {
                    id: "app-3".into(),
                    title: "Notes".into(),
                },
                Captured::Monitor {
                    name: "drm-1".into(),
                },
                Captured::Region {
                    position: (10, -20),
                    size: (300, 200),
                },
            ],
        },
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"id":5,"app_id":"us.zoom.Zoom","kind":"screen_cast","body":{"sources":[{"type":"window","id":"app-3","title":"Notes"},{"type":"monitor","name":"drm-1"},{"type":"region","position":[10,-20],"size":[300,200]}]}}"#
    );
}
/// A frozen 300x100 desk with one monitor and one window.
fn frozen() -> FrozenDesk {
    FrozenDesk {
        frame: "data:image/png;base64,AA==".into(),
        width: 300,
        height: 100,
        monitors: vec![ShotArea {
            name: "DP-1".into(),
            area: ShotRect {
                x: 0,
                y: 0,
                width: 300,
                height: 100,
            },
        }],
        windows: vec![ShotWindow {
            title: "~/src".into(),
            app_id: "kitty".into(),
            area: ShotRect {
                x: 10,
                y: 20,
                width: 30,
                height: 40,
            },
        }],
        desk: DeskRect {
            position: (-10, 0),
            size: (150, 50),
        },
    }
}

#[test]
fn a_screenshot_picker_carries_the_frozen_desk_and_its_areas() {
    let written = serde_json::to_string(&PortalKind::Screenshot(frozen())).expect("it serializes");

    assert_eq!(
        written,
        r#"{"kind":"screenshot","body":{"frame":"data:image/png;base64,AA==","width":300,"height":100,"monitors":[{"name":"DP-1","area":{"x":0,"y":0,"width":300,"height":100}}],"windows":[{"title":"~/src","app_id":"kitty","area":{"x":10,"y":20,"width":30,"height":40}}],"desk":{"position":[-10,0],"size":[150,50]}}}"#
    );
}

#[test]
fn the_screenshot_and_color_answers_the_sdk_sends_parse() {
    for (sent, answer) in [
        (
            r#"{"kind":"screenshot","area":{"x":1,"y":2,"width":3,"height":4}}"#,
            PortalAnswer::Screenshot {
                area: ShotRect {
                    x: 1,
                    y: 2,
                    width: 3,
                    height: 4,
                },
            },
        ),
        (
            r#"{"kind":"pick_color","x":5,"y":6}"#,
            PortalAnswer::PickColor { x: 5, y: 6 },
        ),
    ] {
        let line = format!(r#"{{"type":"answer_portal_request","id":4,"answer":{sent}}}"#);
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(&line).expect("the SDK's own wire form"),
            ChromeMessage::AnswerPortalRequest { id: 4, answer },
            "{sent}"
        );
    }
}

#[test]
fn a_frozen_desk_takes_only_its_own_answer_inside_the_frame() {
    let picker = PortalKind::Screenshot(frozen());
    let picking = PortalKind::PickColor(frozen());
    let area = |x, y, width, height| PortalAnswer::Screenshot {
        area: ShotRect {
            x,
            y,
            width,
            height,
        },
    };

    assert!(picker.accepts(&area(0, 0, 300, 100)));
    assert!(
        !picker.accepts(&area(290, 0, 20, 10)),
        "past the right edge"
    );
    assert!(!picker.accepts(&area(0, 0, 0, 10)), "empty");
    assert!(!picker.accepts(&PortalAnswer::PickColor { x: 1, y: 1 }));
    assert!(picking.accepts(&PortalAnswer::PickColor { x: 299, y: 99 }));
    assert!(!picking.accepts(&PortalAnswer::PickColor { x: 300, y: 0 }));
    assert!(!picking.accepts(&area(0, 0, 1, 1)));
    assert_eq!(area(0, 0, 1, 1).response(), 0);
    assert_eq!(PortalAnswer::PickColor { x: 0, y: 0 }.response(), 0);
}
