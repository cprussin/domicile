//! Tests for the Settings app's native messaging host.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use domicile_launch::control::{Request, Response, SettingsFiles};
use domicile_launch::settings::{answer, read_message, watched, write_message, Host};
use domicile_launch::site_permissions::{Permission, Setting, SitePermission, SiteSettings};
use serde_json::{json, Value};

#[test]
fn a_message_is_its_length_then_its_json() {
    // Chrome's native messaging framing: a 32-bit length in native byte
    // order, then that many bytes of UTF-8 JSON.
    let mut sent = Vec::new();
    write_message(&mut sent, &json!({"type": "changed"})).expect("a Vec takes any write");

    let mut expected = 18_u32.to_ne_bytes().to_vec();
    expected.extend_from_slice(b"{\"type\":\"changed\"}");
    assert_eq!(sent, expected);
}

#[test]
fn a_message_reads_back_and_the_end_of_input_is_no_message() {
    let mut framed = Vec::new();
    write_message(&mut framed, &json!({"id": 1, "type": "read"})).expect("a Vec takes any write");
    let mut reader = framed.as_slice();

    assert_eq!(
        read_message(&mut reader).expect("a whole message"),
        Some(json!({"id": 1, "type": "read"}))
    );
    // Chrome closes stdin when the app's port closes.
    assert_eq!(read_message(&mut reader).expect("a clean end"), None);
}

#[test]
fn reading_gives_each_file_with_whether_it_can_be_written() {
    let host = a_host(FILES.clone());
    assert_eq!(
        host.answer(&json!({"id": 7, "type": "read"})),
        json!({
            "id": 7,
            "type": "files",
            "config": {
                "path": "/home/me/.config/domicile/domicile.json",
                "text": "{\"theme\":{\"mode\":\"dark\"}}",
                "writable": true,
            },
            "evaluated": null,
            "shell": {
                "path": "/nix/store/x-shell.ts",
                "text": "export const Shell = runManganese();",
                "writable": false,
            },
        })
    );
}

#[test]
fn a_module_config_comes_with_the_json_it_evaluated_to() {
    // The form shows a module config's values but cannot write them back
    // into code.
    let host = a_host(SettingsFiles {
        config: Some(PathBuf::from("/home/me/.config/domicile/domicile.ts")),
        evaluated: Some(PathBuf::from("/run/d/config.json")),
        shell: None,
    });
    let reply = host.answer(&json!({"id": 1, "type": "read"}));
    assert_eq!(reply["evaluated"], json!("{\"idle\":{}}"));
    assert_eq!(reply["shell"], Value::Null);
}

#[test]
fn a_config_is_written_where_the_desktop_found_it() {
    let host = a_host(FILES.clone());
    let text = "{\"theme\":{\"mode\":\"light\"}}";
    assert_eq!(
        host.answer(&json!({"id": 2, "type": "write", "file": "config", "text": text})),
        json!({"id": 2, "type": "written"})
    );
    assert_eq!(
        host.written.take(),
        vec![(
            PathBuf::from("/home/me/.config/domicile/domicile.json"),
            text.to_string()
        )]
    );
}

#[test]
fn a_json_config_the_compositor_would_refuse_is_not_written() {
    // The compositor keeps the last good config, so a bad one on disk would
    // be silently ignored. Refuse it here, where the app can say why.
    let host = a_host(FILES.clone());
    let reply = host.answer(&json!({"id": 3, "type": "write", "file": "config", "text": "{\"theme\":{\"mode\":\"system\"}}"}));
    assert_eq!(reply["type"], json!("refused"));
    assert!(
        reply["why"].as_str().unwrap().contains("system"),
        "the refusal did not carry the config's error: {reply}"
    );
    assert!(host.written.take().is_empty());
}

#[test]
fn a_file_that_cannot_be_written_is_refused() {
    // Home-manager links the config into the Nix store, which is read-only.
    let host = a_host(FILES.clone());
    let reply = host.answer(&json!({"id": 4, "type": "write", "file": "shell", "text": "x"}));
    assert_eq!(reply["type"], json!("refused"));
    assert!(host.written.take().is_empty());
}

#[test]
fn a_desktop_with_no_shell_file_has_none_to_write() {
    let host = a_host(SettingsFiles::default());
    let reply = host.answer(&json!({"id": 5, "type": "write", "file": "shell", "text": "x"}));
    assert_eq!(reply["type"], json!("refused"));
}

#[test]
fn site_permissions_are_the_desktops() {
    let host = a_host(FILES.clone());
    assert_eq!(
        host.answer(&json!({"id": 6, "type": "site_permissions"})),
        json!({
            "id": 6,
            "type": "site_permissions",
            "defaults": {"camera": "ask"},
            "sites": [{"origin": "https://meet.example", "permission": "camera", "setting": "allow"}],
        })
    );
}

#[test]
fn a_site_permission_is_set_on_the_desktop() {
    let host = a_host(FILES.clone());
    assert_eq!(
        host.answer(&json!({"id": 8, "type": "set_site_permission", "site": {"origin": "https://meet.example", "permission": "camera", "setting": "block"}})),
        json!({"id": 8, "type": "stored"})
    );
    assert_eq!(
        host.asked.take().last(),
        Some(&Request::SetSitePermission {
            site: SitePermission {
                origin: "https://meet.example".to_string(),
                permission: Permission::Camera,
                setting: Setting::Block,
            }
        })
    );
}

#[test]
fn a_desktop_that_refused_is_quoted() {
    let host = Fake {
        refuse: true,
        ..Fake::new(FILES.clone())
    };
    assert_eq!(
        host.answer(&json!({"id": 9, "type": "site_permissions"})),
        json!({"id": 9, "type": "refused", "why": "the engine is not answering"})
    );
}

#[test]
fn a_request_the_host_does_not_know_is_refused_with_its_id() {
    let host = a_host(FILES.clone());
    let reply = host.answer(&json!({"id": 10, "type": "reboot"}));
    assert_eq!(reply["id"], json!(10));
    assert_eq!(reply["type"], json!("refused"));
}

#[test]
fn the_host_watches_the_directory_of_each_file_once() {
    // Editors replace a file by renaming over it, which a watch on the file
    // itself would lose.
    assert_eq!(
        watched(&SettingsFiles {
            config: Some(PathBuf::from("/home/me/.config/domicile/domicile.json")),
            evaluated: None,
            shell: Some(PathBuf::from("/home/me/.config/domicile/shell.ts")),
        }),
        vec![PathBuf::from("/home/me/.config/domicile")]
    );
}

static FILES: std::sync::LazyLock<SettingsFiles> = std::sync::LazyLock::new(|| SettingsFiles {
    config: Some(PathBuf::from("/home/me/.config/domicile/domicile.json")),
    evaluated: None,
    shell: Some(PathBuf::from("/nix/store/x-shell.ts")),
});

/// A desktop and a file system in memory.
struct Fake {
    files: SettingsFiles,
    refuse: bool,
    asked: RefCell<Vec<Request>>,
    written: RefCell<Vec<(PathBuf, String)>>,
}

fn a_host(files: SettingsFiles) -> Fake {
    Fake::new(files)
}

impl Fake {
    fn new(files: SettingsFiles) -> Self {
        Self {
            files,
            refuse: false,
            asked: RefCell::new(Vec::new()),
            written: RefCell::new(Vec::new()),
        }
    }

    /// Answers `message` with this fake as the host.
    fn answer(&self, message: &Value) -> Value {
        answer(
            message,
            &Host {
                ask: &|request| {
                    self.asked.borrow_mut().push(request.clone());
                    if self.refuse {
                        return Ok(Response::Refused {
                            why: "the engine is not answering".to_string(),
                        });
                    }
                    Ok(match request {
                        Request::SettingsFiles => Response::SettingsFiles {
                            files: self.files.clone(),
                        },
                        Request::SitePermissions => Response::SitePermissions(SiteSettings {
                            defaults: BTreeMap::from([(Permission::Camera, Setting::Ask)]),
                            sites: vec![SitePermission {
                                origin: "https://meet.example".to_string(),
                                permission: Permission::Camera,
                                setting: Setting::Allow,
                            }],
                        }),
                        Request::SetSitePermission { .. } => Response::Stored,
                        other => panic!("the host never asks {other:?}"),
                    })
                },
                read: &|path| match path.to_str() {
                    Some("/home/me/.config/domicile/domicile.json") => {
                        Ok("{\"theme\":{\"mode\":\"dark\"}}".to_string())
                    }
                    Some("/home/me/.config/domicile/domicile.ts") => {
                        Ok("export const idle = {};".to_string())
                    }
                    Some("/run/d/config.json") => Ok("{\"idle\":{}}".to_string()),
                    Some("/nix/store/x-shell.ts") => {
                        Ok("export const Shell = runManganese();".to_string())
                    }
                    _ => Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
                },
                writable: &|path: &Path| !path.starts_with("/nix/store"),
                write: &|path, text| {
                    self.written
                        .borrow_mut()
                        .push((path.to_path_buf(), text.to_string()));
                    Ok(())
                },
            },
        )
    }
}
