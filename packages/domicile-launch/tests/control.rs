//! Tests for the control socket protocol.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use domicile_launch::control::{
    answer, parse_response, Desktop, LoadShell, OpenUrl, Response, Screenshot, SendShell,
    SettingsFiles, Shot,
};
use domicile_launch::site_permissions::{Permission, Setting, SitePermission, SiteSettings};

#[test]
fn a_desktop_says_which_shell_it_is_running() {
    // Written out rather than serialized from `Request::WhichShell`, so the
    // test checks the wire format rather than `serde` against itself.
    assert_eq!(
        answered(
            "{\"type\":\"which_shell\"}",
            Path::new("/desktops/mine/shell.js"),
            &|_, _| panic!("a question is answered where it lands, not dialed on"),
        ),
        Response::Shell {
            module: PathBuf::from("/desktops/mine/shell.js")
        }
    );
}

#[test]
fn a_desktop_told_to_load_a_shell_tells_the_engine_and_says_what_it_serves() {
    // The supervisor forwards this to the engine. The dial is injected so no
    // engine is needed.
    let told = Cell::new(None);
    let answered = answered(
        "{\"type\":\"load_shell\",\"root\":\"/desktops/other\",\"module\":\"shell.js\"}",
        Path::new("/desktops/mine/shell.js"),
        &|root, module| {
            told.set(Some((root.to_path_buf(), module.to_path_buf())));
            Ok(())
        },
    );

    assert_eq!(
        told.take(),
        Some((PathBuf::from("/desktops/other"), PathBuf::from("shell.js")))
    );
    // Replies with the new shell, as `which-shell` would.
    assert_eq!(
        answered,
        Response::Shell {
            module: PathBuf::from("/desktops/other/shell.js")
        }
    );
}

#[test]
fn an_engine_that_refused_the_shell_is_quoted_to_whoever_typed_the_command() {
    // Pass the engine's reason through verbatim; the user cannot see the
    // engine's log.
    let Response::Refused { why } = answered(
        "{\"type\":\"load_shell\",\"root\":\"/desktops/other\",\"module\":\"shell.js\"}",
        Path::new("/desktops/mine/shell.js"),
        &|_, _| Err("this engine has no shell window to load a shell into".to_string()),
    ) else {
        panic!("an engine that refused the shell is not a desktop that loaded it");
    };
    assert!(
        why.contains("no shell window"),
        "the refusal did not carry the engine's own words: {why}"
    );
}

#[test]
fn a_line_that_is_not_a_request_is_refused_and_quoted_back() {
    // The refusal quotes the line so the client sees what was rejected.
    let Response::Refused { why } =
        answered("{\"type\":\"reboot\"}", Path::new("/shell.js"), &|_, _| {
            panic!("a line that is not a request reaches no engine")
        })
    else {
        panic!("a request this desktop has never heard of is not a request");
    };
    assert!(
        why.contains("reboot"),
        "the refusal did not quote the line: {why}"
    );
}

#[test]
fn a_desktop_told_to_open_an_address_tells_the_engine() {
    // Forwarded to the engine, like `load_shell`.
    let told = Cell::new(None);
    let answered = answered_opening(
        "{\"type\":\"open_url\",\"url\":\"https://example.com/\"}",
        &|url| {
            told.set(Some(url.to_string()));
            Ok(())
        },
    );

    assert_eq!(told.take(), Some("https://example.com/".to_string()));
    assert_eq!(answered, Response::Opened);
}

#[test]
fn a_desktop_told_to_open_an_app_tells_the_engine() {
    let told = Cell::new(None);
    let answered = reply_to(
        "{\"type\":\"open_app\",\"url\":\"https://example.com/\"}",
        &Desktop {
            open_app: &|url| {
                told.set(Some(url.to_string()));
                Ok(())
            },
            ..nothing_dialed()
        },
    );

    assert_eq!(told.take(), Some("https://example.com/".to_string()));
    assert_eq!(answered, Response::Opened);
}

#[test]
fn an_engine_that_would_not_open_the_address_is_quoted() {
    let Response::Refused { why } = answered_opening(
        "{\"type\":\"open_url\",\"url\":\"https://example.com/\"}",
        &|_| Err("this engine has no shell page to open it in".to_string()),
    ) else {
        panic!("an engine that refused the address is not one that opened it");
    };
    assert!(
        why.contains("no shell page"),
        "the refusal did not carry the engine's own words: {why}"
    );
}

#[test]
fn a_desktop_told_to_take_a_screenshot_tells_the_compositor_and_says_where_it_is() {
    let told = Cell::new(None);
    let answered = answered_capturing(
        "{\"type\":\"screenshot\",\"file\":\"/home/me/shot.png\"}",
        &|file| {
            told.set(Some(file.map(Path::to_path_buf)));
            Ok(Shot::Saved(PathBuf::from("/home/me/shot.png")))
        },
    );

    assert_eq!(told.take(), Some(Some(PathBuf::from("/home/me/shot.png"))));
    assert_eq!(
        answered,
        Response::Captured {
            file: PathBuf::from("/home/me/shot.png")
        }
    );
}

#[test]
fn a_screenshot_with_no_file_is_the_shells_and_the_answer_is_where_it_saved_it() {
    let told = Cell::new(None);
    let answered = answered_capturing("{\"type\":\"screenshot\"}", &|file| {
        told.set(Some(file.map(Path::to_path_buf)));
        Ok(Shot::Saved(PathBuf::from(
            "/home/me/Pictures/Screenshots/Screenshot.png",
        )))
    });

    assert_eq!(told.take(), Some(None));
    assert_eq!(
        answered,
        Response::Captured {
            file: PathBuf::from("/home/me/Pictures/Screenshots/Screenshot.png")
        }
    );
}

#[test]
fn a_screenshot_the_user_dismissed_is_canceled() {
    assert_eq!(
        answered_capturing("{\"type\":\"screenshot\"}", &|_| Ok(Shot::Canceled)),
        Response::Canceled
    );
}

#[test]
fn a_compositor_that_could_not_take_the_screenshot_is_quoted() {
    let Response::Refused { why } = answered_capturing(
        "{\"type\":\"screenshot\",\"file\":\"/home/me/shot.png\"}",
        &|_| Err("could not write /home/me/shot.png".to_string()),
    ) else {
        panic!("a compositor that refused the screenshot is not one that took it");
    };
    assert!(
        why.contains("could not write"),
        "the refusal did not carry the compositor's own words: {why}"
    );
}

#[test]
fn a_desktop_told_to_send_the_shell_a_command_tells_the_compositor() {
    let told = Cell::new(None);
    let answered = answered_sending(
        "{\"type\":\"send_shell\",\"command\":[\"focus\",\"right\"]}",
        &|command| {
            told.set(Some(command.to_vec()));
            Ok(())
        },
    );

    assert_eq!(
        told.take(),
        Some(vec!["focus".to_string(), "right".to_string()])
    );
    assert_eq!(answered, Response::Sent);
}

#[test]
fn a_compositor_that_did_not_send_the_command_is_quoted() {
    let Response::Refused { why } = answered_sending(
        "{\"type\":\"send_shell\",\"command\":[\"focus\",\"right\"]}",
        &|_| Err("no page of this desktop listens for commands".to_string()),
    ) else {
        panic!("a compositor that refused the command is not one that sent it");
    };
    assert!(
        why.contains("no page"),
        "the refusal did not carry the compositor's own words: {why}"
    );
}

#[test]
fn a_desktop_says_which_files_the_settings_app_edits() {
    let files = SettingsFiles {
        config: Some(PathBuf::from("/home/me/.config/domicile/domicile.json")),
        evaluated: None,
        shell: Some(PathBuf::from("/home/me/.config/domicile/shell.ts")),
    };
    assert_eq!(
        reply_to(
            "{\"type\":\"settings_files\"}",
            &Desktop {
                files: &files,
                ..nothing_dialed()
            }
        ),
        Response::SettingsFiles {
            files: files.clone()
        }
    );
}

#[test]
fn a_desktop_asked_for_site_permissions_asks_the_engine() {
    assert_eq!(
        reply_to(
            "{\"type\":\"site_permissions\"}",
            &Desktop {
                permissions: &|| Ok(stored()),
                ..nothing_dialed()
            }
        ),
        Response::SitePermissions(stored())
    );
}

#[test]
fn a_desktop_told_to_set_a_site_permission_tells_the_engine() {
    let told = Cell::new(None);
    let answered = reply_to(
        "{\"type\":\"set_site_permission\",\"site\":{\"origin\":\"https://meet.example\",\"permission\":\"camera\",\"setting\":\"block\"}}",
        &Desktop {
            set_permission: &|site| {
                told.set(Some(site.clone()));
                Ok(())
            },
            ..nothing_dialed()
        },
    );

    assert_eq!(told.take(), Some(a_site(Setting::Block)));
    assert_eq!(answered, Response::Stored);
}

#[test]
fn an_engine_that_would_not_set_a_site_permission_is_quoted() {
    let Response::Refused { why } = reply_to(
        "{\"type\":\"set_site_permission\",\"site\":{\"origin\":\"https://meet.example\",\"permission\":\"camera\",\"setting\":\"block\"}}",
        &Desktop {
            set_permission: &|_| Err("\"camera\" is not a permission".to_string()),
            ..nothing_dialed()
        },
    ) else {
        panic!("an engine that refused the setting is not one that stored it");
    };
    assert!(
        why.contains("not a permission"),
        "the refusal did not carry the engine's own words: {why}"
    );
}

#[test]
fn a_desktop_told_to_load_an_unpacked_extension_tells_the_engine() {
    let told = RefCell::new(None);
    let answered = reply_to(
        "{\"type\":\"load_unpacked\",\"directory\":\"/home/me/src/my-extension\"}",
        &Desktop {
            load_unpacked: &|directory| {
                told.replace(Some(directory.to_path_buf()));
                Ok("abcdefghijklmnopabcdefghijklmnop".to_string())
            },
            ..nothing_dialed()
        },
    );

    assert_eq!(
        told.take(),
        Some(PathBuf::from("/home/me/src/my-extension"))
    );
    assert_eq!(
        answered,
        Response::LoadedUnpacked {
            id: "abcdefghijklmnopabcdefghijklmnop".to_string()
        }
    );
}

#[test]
fn a_desktop_told_to_uninstall_an_extension_tells_the_engine() {
    let told = RefCell::new(None);
    let answered = reply_to(
        "{\"type\":\"uninstall_extension\",\"id\":\"abcdefghijklmnopabcdefghijklmnop\"}",
        &Desktop {
            uninstall_extension: &|id| {
                told.replace(Some(id.to_string()));
                Ok(())
            },
            ..nothing_dialed()
        },
    );

    assert_eq!(
        told.take().as_deref(),
        Some("abcdefghijklmnopabcdefghijklmnop")
    );
    assert_eq!(answered, Response::Uninstalled);
}

#[test]
fn a_desktop_asked_which_extensions_the_config_installed_asks_the_engine() {
    assert_eq!(
        reply_to(
            "{\"type\":\"config_extensions\"}",
            &Desktop {
                config_extensions: &|| Ok(vec!["abcdefghijklmnopabcdefghijklmnop".to_string()]),
                ..nothing_dialed()
            }
        ),
        Response::ConfigExtensions {
            ids: vec!["abcdefghijklmnopabcdefghijklmnop".to_string()]
        }
    );
}

/// What the engine stores: camera's default, and one site's camera.
fn stored() -> SiteSettings {
    SiteSettings {
        defaults: BTreeMap::from([(Permission::Camera, Setting::Ask)]),
        sites: vec![a_site(Setting::Allow)],
    }
}

/// `https://meet.example`'s camera, set to `setting`.
fn a_site(setting: Setting) -> SitePermission {
    SitePermission {
        origin: "https://meet.example".to_string(),
        permission: Permission::Camera,
        setting,
    }
}

/// Sends one request line to `desktop` and parses the one reply line.
fn reply_to(line: &str, desktop: &Desktop) -> Response {
    parse_response(answer(line, desktop).trim()).expect("a desktop answers with a response")
}

/// A desktop serving `/shell.js` with no settings files, whose every dial
/// panics. Tests replace the one they expect.
fn nothing_dialed() -> Desktop<'static> {
    Desktop {
        capture: &|_| panic!("only screenshot captures anything"),
        config_extensions: &|| panic!("only config_extensions lists the config's extensions"),
        files: &NO_FILES,
        load: &|_, _| panic!("only load_shell loads anything"),
        load_unpacked: &|_| panic!("only load_unpacked loads an extension"),
        module: Path::new("/shell.js"),
        open: &|_| panic!("only open_url opens a browser window"),
        open_app: &|_| panic!("only open_app opens an app window"),
        permissions: &|| panic!("only site_permissions lists site permissions"),
        send: &|_| panic!("only send_shell sends anything"),
        set_permission: &|_| panic!("only set_site_permission sets one"),
        uninstall_extension: &|_| panic!("only uninstall_extension uninstalls one"),
    }
}

static NO_FILES: SettingsFiles = SettingsFiles {
    config: None,
    evaluated: None,
    shell: None,
};

/// Sends one request line and parses the one reply line.
fn answered(line: &str, module: &Path, load: LoadShell) -> Response {
    reply_to(
        line,
        &Desktop {
            load,
            module,
            ..nothing_dialed()
        },
    )
}

/// [`answered`], for `open_url`.
fn answered_opening(line: &str, open: OpenUrl) -> Response {
    reply_to(
        line,
        &Desktop {
            open,
            ..nothing_dialed()
        },
    )
}

/// [`answered`], for `screenshot`.
fn answered_capturing(line: &str, capture: Screenshot) -> Response {
    reply_to(
        line,
        &Desktop {
            capture,
            ..nothing_dialed()
        },
    )
}

/// [`answered`], for `send_shell`.
fn answered_sending(line: &str, send: SendShell) -> Response {
    reply_to(
        line,
        &Desktop {
            send,
            ..nothing_dialed()
        },
    )
}
