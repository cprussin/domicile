//! Wire shapes for portal dialogs.
//!
//! Pinned as JSON because the SDK and the engine's relay hard-code them. See
//! `docs/architecture/PORTALS.md`.

use domicile_protocol::{
    AccessDialog, ChromeMessage, HostMessage, PortalAnswer, PortalKind, PortalRequest,
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
