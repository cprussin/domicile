//! Wire shapes for portal dialogs.
//!
//! Pinned as JSON because the SDK and the engine's relay hard-code them. See
//! `docs/architecture/PORTALS.md`.

use std::collections::BTreeMap;

use domicile_protocol::{
    AccessDialog, AppChooserDialog, ChromeMessage, FileChoice, FileChoiceOption, FileChooserAnswer,
    FileChooserDialog, FileChooserMode, FileFilter, HostMessage, Inhibited, Inhibition,
    PortalAnswer, PortalKind, PortalRequest,
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
    })
    .expect("it serializes");

    assert_eq!(
        written,
        r#"{"type":"portal_requests","items":[{"id":1,"app_id":"org.example.App","parent_app_id":"app-3","kind":"access","body":{"title":"Use the camera?","subtitle":"Example wants to see you","body":"","grant_label":"Allow"}}]}"#
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
    for kind in [&chooser, &access, &files] {
        assert!(kind.accepts(&PortalAnswer::Canceled));
        assert!(kind.accepts(&PortalAnswer::Refused));
    }
}
