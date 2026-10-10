//! Tests for the engine command socket protocol.

use std::collections::BTreeMap;
use std::path::Path;

use domicile_launch::command::{
    load_shell_line, open_app_line, open_url_line, reply, set_site_permission_line,
    site_permissions_line, Reply,
};
use domicile_launch::site_permissions::{Permission, Setting, SitePermission, SiteSettings};

#[test]
fn a_load_shell_names_the_version_it_is_written_in() {
    // Each request carries the version, since there is no handshake. The
    // expected line is written out because the engine's `command_protocol.cc`
    // does not share this crate's serializer.
    assert_eq!(
        load_shell_line(Path::new("/x/dist"), Path::new("shell.js")),
        "{\"type\":\"load_shell\",\"version\":1,\"root\":\"/x/dist\",\"module\":\"shell.js\"}\n"
    );
}

#[test]
fn an_open_url_names_the_version_it_is_written_in() {
    assert_eq!(
        open_url_line("https://example.com/?q=\"x\""),
        "{\"type\":\"open_url\",\"version\":1,\"url\":\"https://example.com/?q=\\\"x\\\"\"}\n"
    );
}

#[test]
fn an_open_app_is_an_open_url_that_asks_for_an_app_window() {
    // A key rather than a new type, so an engine older than it opens a browser
    // window instead of refusing.
    assert_eq!(
        open_app_line("https://example.com/"),
        "{\"type\":\"open_url\",\"version\":1,\"url\":\"https://example.com/\",\"app\":true}\n"
    );
}

#[test]
fn an_engine_that_opened_the_address_says_so() {
    assert_eq!(reply("{\"type\":\"opened\"}").unwrap(), Reply::Opened);
}

#[test]
fn an_engine_that_served_the_shell_says_so() {
    assert_eq!(reply("{\"type\":\"loaded\"}").unwrap(), Reply::Loaded);
}

#[test]
fn an_engine_that_refused_says_why() {
    // Keep the engine's reason verbatim; each cause needs a different fix.
    assert_eq!(
        reply("{\"type\":\"refused\",\"why\":\"this engine speaks version 1\"}").unwrap(),
        Reply::Refused {
            why: "this engine speaks version 1".to_string()
        }
    );
}

#[test]
fn an_answer_that_is_not_one_is_not_read_as_a_refusal() {
    // An unknown reply, such as from an older engine, is an error, not a
    // refusal.
    assert!(reply("{\"type\":\"loading\"}").is_err());
}

#[test]
fn a_question_about_site_permissions_names_the_version_it_is_written_in() {
    assert_eq!(
        site_permissions_line(),
        "{\"type\":\"site_permissions\",\"version\":1}\n"
    );
}

#[test]
fn a_site_permission_is_set_by_origin_permission_and_setting() {
    assert_eq!(
        set_site_permission_line(&SitePermission {
            origin: "https://meet.example".to_string(),
            permission: Permission::Camera,
            setting: Setting::Block,
        }),
        "{\"type\":\"set_site_permission\",\"version\":1,\"origin\":\"https://meet.example\",\"permission\":\"camera\",\"setting\":\"block\"}\n"
    );
}

#[test]
fn an_engine_lists_each_site_s_stored_permissions() {
    assert_eq!(
        reply(
            "{\"type\":\"site_permissions\",\"defaults\":{\"camera\":\"ask\",\"notifications\":\"allow\"},\"sites\":[\
             {\"origin\":\"https://meet.example\",\"permission\":\"microphone\",\"setting\":\"allow\"},\
             {\"origin\":\"https://maps.example\",\"permission\":\"location\",\"setting\":\"block\"}]}"
        )
        .unwrap(),
        Reply::SitePermissions(SiteSettings {
            defaults: BTreeMap::from([
                (Permission::Camera, Setting::Ask),
                (Permission::Notifications, Setting::Allow),
            ]),
            sites: vec![
                SitePermission {
                    origin: "https://meet.example".to_string(),
                    permission: Permission::Microphone,
                    setting: Setting::Allow,
                },
                SitePermission {
                    origin: "https://maps.example".to_string(),
                    permission: Permission::Location,
                    setting: Setting::Block,
                },
            ]
        })
    );
}

#[test]
fn an_engine_that_stored_a_setting_says_so() {
    assert_eq!(reply("{\"type\":\"set\"}").unwrap(), Reply::Set);
}
