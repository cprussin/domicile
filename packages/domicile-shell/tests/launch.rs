//! Finding the shell a config names, and what would start it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use domicile_config::ShellRef;
use domicile_shell::{
    launch_command, resolve, ChromeSession, ResolvedShell, ShellError, ShellRuntime, MANIFEST_NAME,
};
use tempfile::TempDir;

const HOST_PROTOCOL: u32 = 14;

/// A shell package on disk, with whatever manifest the caller wants in it.
fn install(root: &Path, directory: &str, manifest: &str) -> PathBuf {
    let package = root.join(directory);
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join(MANIFEST_NAME), manifest).unwrap();
    package
}

fn manifest_for(name: &str, protocol: u32) -> String {
    format!(
        r#"{{"name":"{name}","description":"d","protocol":{protocol},"entry":"build/main.js"}}"#
    )
}

fn session(socket: &str) -> ChromeSession {
    ChromeSession {
        socket: PathBuf::from(socket),
        wayland_display: "wayland-2".into(),
        composited: true,
        protocol_version: HOST_PROTOCOL,
        settings: toml::Table::new(),
    }
}

fn runtime() -> ShellRuntime {
    ShellRuntime {
        program: PathBuf::from("electron"),
        extra_args: Vec::new(),
    }
}

fn resolved(directory: PathBuf) -> ResolvedShell {
    resolve(&ShellRef::Path(directory), &[], Path::new("/nowhere")).unwrap()
}

// ---- resolve --------------------------------------------------------------

#[test]
fn a_named_shell_is_found_on_the_search_path() {
    let root = TempDir::new().unwrap();
    let shells = root.path().join("share/domicile/shells");
    install(&shells, "manganese", &manifest_for("manganese", 14));

    let found = resolve(
        &ShellRef::Name("manganese".into()),
        std::slice::from_ref(&shells),
        Path::new("/nowhere"),
    )
    .unwrap();

    assert_eq!(found.directory, shells.join("manganese"));
    assert_eq!(found.manifest.name, "manganese");
}

#[test]
fn the_nearest_copy_of_a_name_wins() {
    // The point of an ordered search path: a shell in the user's own directory
    // shadows the system one, so a modified build can be tried without
    // replacing what is installed for everyone.
    let root = TempDir::new().unwrap();
    let user = root.path().join("user");
    let system = root.path().join("system");
    install(&user, "manganese", &manifest_for("manganese", 14));
    install(&system, "manganese", &manifest_for("manganese", 14));

    let found = resolve(
        &ShellRef::Name("manganese".into()),
        &[user.clone(), system],
        Path::new("/nowhere"),
    )
    .unwrap();

    assert_eq!(found.directory, user.join("manganese"));
}

#[test]
fn a_directory_without_a_manifest_is_not_a_shell() {
    // Skipped rather than fatal: an unrelated directory sharing the name on an
    // *earlier* search-path entry must not hide the real shell behind it.
    let root = TempDir::new().unwrap();
    let user = root.path().join("user");
    let system = root.path().join("system");
    std::fs::create_dir_all(user.join("manganese")).unwrap();
    install(&system, "manganese", &manifest_for("manganese", 14));

    let found = resolve(
        &ShellRef::Name("manganese".into()),
        &[user, system.clone()],
        Path::new("/nowhere"),
    )
    .unwrap();

    assert_eq!(found.directory, system.join("manganese"));
}

#[test]
fn a_missing_name_reports_everywhere_it_looked() {
    // The commonest failure by far is a shell installed somewhere that is not
    // on the path, and a bare "not found" leaves the reader guessing where
    // Domicile even looked.
    let err = resolve(
        &ShellRef::Name("nope".into()),
        &[PathBuf::from("/a/shells"), PathBuf::from("/b/shells")],
        Path::new("/nowhere"),
    )
    .unwrap_err();

    let ShellError::NotFound {
        reference,
        searched,
    } = err
    else {
        panic!("expected NotFound, got {err:?}");
    };
    assert_eq!(reference, "nope");
    assert_eq!(
        searched,
        [PathBuf::from("/a/shells"), PathBuf::from("/b/shells")]
    );
}

#[test]
fn a_path_reference_ignores_the_search_path() {
    // How a shell is run out of a checkout, and the case a developer hits
    // first: `package = "./my-shell"` must not require installing anything.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "my-shell", &manifest_for("whatever", 14));

    let found = resolve(
        &ShellRef::Path(package.clone()),
        &[PathBuf::from("/ignored")],
        Path::new("/nowhere"),
    )
    .unwrap();

    assert_eq!(found.directory, package);
}

#[test]
fn a_path_that_is_not_a_shell_says_so_rather_than_listing_a_search_path() {
    let root = TempDir::new().unwrap();
    let err = resolve(
        &ShellRef::Path(root.path().join("absent")),
        &[],
        Path::new("/nowhere"),
    )
    .unwrap_err();

    let ShellError::NotFound { searched, .. } = err else {
        panic!("expected NotFound, got {err:?}");
    };
    assert_eq!(searched, [root.path().join("absent")]);
}

#[test]
fn a_package_whose_manifest_disagrees_with_its_directory_is_refused() {
    // Only for a *named* lookup, where the directory name is the thing that was
    // searched for. Letting them differ means `package = "manganese"` starts
    // something that calls itself otherwise, and nothing ever says so.
    let root = TempDir::new().unwrap();
    let shells = root.path().join("shells");
    install(&shells, "manganese", &manifest_for("something-else", 14));

    let err = resolve(
        &ShellRef::Name("manganese".into()),
        &[shells],
        Path::new("/nowhere"),
    )
    .unwrap_err();

    let ShellError::Invalid { message, .. } = err else {
        panic!("expected Invalid, got {err:?}");
    };
    assert!(message.contains("manganese"), "{message}");
    assert!(message.contains("something-else"), "{message}");
}

#[test]
fn a_path_reference_may_be_named_anything() {
    // The mirror of the rule above: nothing searched for a name here, so the
    // directory a checkout happens to sit in says nothing about the shell.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "checkout-dir", &manifest_for("manganese", 14));

    assert_eq!(
        resolve(&ShellRef::Path(package), &[], Path::new("/nowhere"))
            .unwrap()
            .manifest
            .name,
        "manganese"
    );
}

// ---- launch_command -------------------------------------------------------

#[test]
fn the_shell_is_run_from_its_own_entry_point() {
    // The manifest's `entry`, resolved against the package — not Electron's
    // `package.json` `main`. Two manifests both claiming to name the entry
    // point is how the shell contract came to be decorative; this is the one
    // that decides.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));

    let launch = launch_command(
        &resolved(package.clone()),
        &session("/run/c.sock"),
        &runtime(),
    )
    .unwrap();

    assert_eq!(launch.program, OsString::from("electron"));
    assert_eq!(
        launch.args,
        [
            OsString::from("--ozone-platform=wayland"),
            package.join("build/main.js").into_os_string(),
        ]
    );
    assert_eq!(launch.directory, package);
}

#[test]
fn the_shell_is_told_where_to_connect_and_what_display_to_use() {
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));

    let launch = launch_command(&resolved(package), &session("/run/c.sock"), &runtime()).unwrap();

    assert_eq!(
        launch.env,
        [
            (
                "DOMICILE_CHROME_SOCKET".to_string(),
                "/run/c.sock".to_string()
            ),
            ("DOMICILE_COMPOSITED".to_string(), "1".to_string()),
            ("WAYLAND_DISPLAY".to_string(), "wayland-2".to_string()),
            ("DOMICILE_SHELL_SETTINGS".to_string(), "{}".to_string()),
        ]
    );
}

#[test]
fn an_uncomposited_session_does_not_set_the_variable_at_all() {
    // Rather than setting it to "0". Every shell reads it as `=== "1"`, so an
    // explicit "0" and an absent variable already mean the same thing — and a
    // shell started by hand inherits whatever the last run exported, which an
    // absent variable cannot silently keep true.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));

    let launch = launch_command(
        &resolved(package),
        &ChromeSession {
            composited: false,
            ..session("/run/c.sock")
        },
        &runtime(),
    )
    .unwrap();

    assert!(
        !launch
            .env
            .iter()
            .any(|(key, _)| key == "DOMICILE_COMPOSITED"),
        "{:?}",
        launch.env
    );
}

#[test]
fn a_shell_speaking_another_protocol_is_refused_before_it_starts() {
    // Before, not at the handshake. Both refuse, but only this one can name the
    // package and the number it declared; a refused handshake is a page that
    // already loaded reporting a mismatch with no idea which of the installed
    // shells it came from.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 13));

    let err = launch_command(&resolved(package), &session("/run/c.sock"), &runtime()).unwrap_err();

    let ShellError::ProtocolMismatch { name, shell, host } = err else {
        panic!("expected ProtocolMismatch, got {err:?}");
    };
    assert_eq!((name.as_str(), shell, host), ("s", 13, HOST_PROTOCOL));
}

#[test]
fn the_environment_can_add_arguments_the_shell_did_not_ask_for() {
    // Electron's sandbox needs a setuid helper that a nix store build does not
    // have, so `--no-sandbox` is what every script in this repo has had to
    // pass. It belongs to the machine rather than to the shell: a manifest that
    // could name it would let a shell turn its own sandbox off.
    //
    // After the entry point, so nothing here can displace the program being
    // run — Electron takes the first non-flag argument as the app.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));

    let launch = launch_command(
        &resolved(package.clone()),
        &session("/run/c.sock"),
        &ShellRuntime {
            program: PathBuf::from("/nix/store/x/electron"),
            extra_args: vec![OsString::from("--no-sandbox")],
        },
    )
    .unwrap();

    assert_eq!(launch.program, OsString::from("/nix/store/x/electron"));
    assert_eq!(
        launch.args,
        [
            OsString::from("--ozone-platform=wayland"),
            package.join("build/main.js").into_os_string(),
            OsString::from("--no-sandbox"),
        ]
    );
}

// ---- relative references ---------------------------------------------------

#[test]
fn a_relative_package_is_resolved_against_the_base() {
    // `package = "./packages/shell-simple"` is the documented developer
    // workflow, and it was broken: the entry point was joined onto the relative
    // directory, and then the child was given that same relative directory as
    // its working directory — so it resolved the argument a second time, from
    // somewhere else, and found nothing.
    //
    // Everything the caller gets back is absolute, so there is no order in
    // which a consumer can apply the two and be wrong.
    let root = TempDir::new().unwrap();
    install(root.path(), "my-shell", &manifest_for("my-shell", 14));

    let found = resolve(
        &ShellRef::Path(PathBuf::from("./my-shell")),
        &[],
        root.path(),
    )
    .unwrap();

    assert_eq!(found.directory, root.path().join("my-shell"));

    let launch = launch_command(&found, &session("/run/c.sock"), &runtime()).unwrap();
    assert_eq!(
        launch.args[1],
        root.path().join("my-shell/build/main.js").into_os_string()
    );
    assert_eq!(launch.directory, root.path().join("my-shell"));
    assert!(
        launch.directory.is_absolute() && Path::new(&launch.args[1]).is_absolute(),
        "a relative reference leaked through: {launch:?}"
    );
}

#[test]
fn a_relative_search_path_entry_is_resolved_against_the_base_too() {
    // Same hazard by the other route: a search path is ordinarily absolute
    // because XDG builds it, but nothing in the type says so.
    let root = TempDir::new().unwrap();
    let shells = root.path().join("share/shells");
    install(&shells, "minimal", &manifest_for("minimal", 14));

    let found = resolve(
        &ShellRef::Name("minimal".into()),
        &[PathBuf::from("share/shells")],
        root.path(),
    )
    .unwrap();

    assert_eq!(found.directory, shells.join("minimal"));
}

#[test]
fn an_absolute_package_ignores_the_base() {
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "my-shell", &manifest_for("my-shell", 14));

    let found = resolve(
        &ShellRef::Path(package.clone()),
        &[],
        Path::new("/somewhere/else"),
    )
    .unwrap();

    assert_eq!(found.directory, package);
}

#[test]
fn a_manifest_that_is_there_and_unreadable_is_reported_rather_than_skipped() {
    // The search skips a directory with no manifest, because an unrelated
    // directory sharing the name on an earlier entry must not hide the real
    // shell behind it. A manifest that *is* there and will not open is the
    // opposite case: it is a broken install of the very shell that was asked
    // for, and skipping it either falls through to a different build under a
    // later entry or reports "not found" naming the directory it is sitting in.
    //
    // A *directory* where the manifest should be, rather than a file with its
    // permissions removed. Both give a non-`NotFound` `ErrorKind`, but `0o000`
    // is still readable as root — so in any rootful container that test passes
    // whatever the code does, and the fix it guards can be reverted whole with
    // the suite still green. There is no uid at which a directory opens as a
    // file, so this needs no escape hatch to be honest about.
    let root = TempDir::new().unwrap();
    let user = root.path().join("user");
    let system = root.path().join("system");
    let package = install(&user, "manganese", &manifest_for("manganese", 14));
    install(&system, "manganese", &manifest_for("manganese", 14));
    std::fs::remove_file(package.join(MANIFEST_NAME)).unwrap();
    std::fs::create_dir(package.join(MANIFEST_NAME)).unwrap();

    let outcome = resolve(
        &ShellRef::Name("manganese".into()),
        &[user, system],
        Path::new("/nowhere"),
    );

    let Err(ShellError::Unreadable { path, .. }) = outcome else {
        panic!("expected the unreadable manifest to be reported, got {outcome:?}");
    };
    assert!(path.ends_with(MANIFEST_NAME), "{path}");
}

#[test]
fn the_shells_own_settings_reach_it_as_json() {
    // `[shell.settings]` is documented as handed to the shell verbatim, and
    // was parsed and then dropped — an author could write a schema, put a table
    // in `domicile.toml`, and find nothing on the other side, with no error
    // because the config itself parsed fine.
    //
    // JSON rather than TOML because the reader is a web page: it has a parser
    // for one of them and not the other.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));
    let settings = toml::from_str::<toml::Table>("rail = \"left\"\nclock = true\n").unwrap();

    let launch = launch_command(
        &resolved(package),
        &ChromeSession {
            settings,
            ..session("/run/c.sock")
        },
        &runtime(),
    )
    .unwrap();

    let carried = launch
        .env
        .iter()
        .find(|(key, _)| key == "DOMICILE_SHELL_SETTINGS")
        .expect("the settings were not passed at all");
    let parsed: serde_json::Value = serde_json::from_str(&carried.1).unwrap();
    assert_eq!(parsed["rail"], "left");
    assert_eq!(parsed["clock"], true);
}

#[test]
fn an_empty_settings_table_is_still_an_object() {
    // One shape for every shell to read, rather than "absent" and "empty" being
    // different cases each of them has to handle.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));

    let launch = launch_command(&resolved(package), &session("/run/c.sock"), &runtime()).unwrap();

    assert!(launch
        .env
        .contains(&("DOMICILE_SHELL_SETTINGS".to_string(), "{}".to_string())));
}

#[test]
fn a_date_in_the_settings_reaches_the_shell_as_a_string() {
    // TOML has a date type and JSON does not, and `toml::Value`'s own
    // `Serialize` bridges that by emitting a tagged object:
    //
    //     {"when":{"$__toml_private_datetime":"1979-05-27T07:32:00Z"}}
    //
    // That marker is `toml`'s internal business, and putting it in front of a
    // shell author makes it part of this contract forever — they would have to
    // reach through a key with a `$__` prefix, named after a crate they never
    // chose, to read a date they wrote in their own config.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));
    let settings =
        toml::from_str::<toml::Table>("when = 1979-05-27T07:32:00Z\nday = 1979-05-27\n").unwrap();

    let launch = launch_command(
        &resolved(package),
        &ChromeSession {
            settings,
            ..session("/run/c.sock")
        },
        &runtime(),
    )
    .unwrap();

    let carried = &launch
        .env
        .iter()
        .find(|(key, _)| key == "DOMICILE_SHELL_SETTINGS")
        .unwrap()
        .1;
    assert!(
        !carried.contains("$__toml"),
        "an internal marker reached the shell: {carried}"
    );
    let parsed: serde_json::Value = serde_json::from_str(carried).unwrap();
    assert_eq!(parsed["when"], "1979-05-27T07:32:00Z");
    assert_eq!(parsed["day"], "1979-05-27");
}

#[test]
fn every_other_toml_type_survives_the_crossing() {
    // The types a settings table is actually made of. Asserted together
    // because the conversion is one function and a hole in it is a hole for
    // whichever type it forgot.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));
    let settings = toml::from_str::<toml::Table>(
        "n = 1\nf = 1.5\ns = \"x\"\nb = true\nlist = [1, \"two\"]\nnan = nan\n\n[nested]\nk = \"v\"\n",
    )
    .unwrap();

    let launch = launch_command(
        &resolved(package),
        &ChromeSession {
            settings,
            ..session("/run/c.sock")
        },
        &runtime(),
    )
    .unwrap();

    let carried = &launch
        .env
        .iter()
        .find(|(key, _)| key == "DOMICILE_SHELL_SETTINGS")
        .unwrap()
        .1;
    let parsed: serde_json::Value = serde_json::from_str(carried).unwrap();
    assert_eq!(parsed["n"], 1);
    assert_eq!(parsed["f"], 1.5);
    assert_eq!(parsed["s"], "x");
    assert_eq!(parsed["b"], true);
    assert_eq!(parsed["list"], serde_json::json!([1, "two"]));
    assert_eq!(parsed["nested"]["k"], "v");
    // JSON has no NaN and `serde_json::Number` refuses one, so a value TOML can
    // hold and JSON cannot becomes `null` — asserted rather than left to a
    // branch nothing drives, because it is a value quietly changing on the way
    // to a shell.
    //
    // Through `as_object().get()` rather than `parsed["nan"]`: indexing a
    // `serde_json::Value` yields `Null` for a key that is *absent* too, so the
    // shorter form would also pass if the key were dropped entirely — and
    // `settings.nan === null` and `!("nan" in settings)` are different things
    // for the shell author this is a contract with.
    assert_eq!(
        parsed.as_object().unwrap().get("nan"),
        Some(&serde_json::Value::Null),
        "a NaN must arrive as an explicit null rather than vanishing"
    );
}

#[test]
fn a_dot_in_the_entry_does_not_reach_the_argument() {
    // `./main.js` is a legal entry and a documented one, and joining it onto an
    // already-absolute directory puts the `.` straight back — so the argument
    // Electron is given, and every message that names it, reads
    // `/pkg/./main.js`. It resolves correctly and looks like a bug, which is
    // the same trade `absolute` was written to settle for the package
    // directory; both halves of the path should agree about what a `.` is
    // worth.
    let root = TempDir::new().unwrap();
    let package = install(
        root.path(),
        "s",
        r#"{"name":"s","description":"d","protocol":14,"entry":"./main.js"}"#,
    );

    let launch = launch_command(
        &resolved(package.clone()),
        &session("/run/c.sock"),
        &runtime(),
    )
    .unwrap();

    assert_eq!(launch.args[1], package.join("main.js").into_os_string());
    assert!(
        !launch.args[1].to_string_lossy().contains("/./"),
        "a no-op component survived into the argument: {:?}",
        launch.args[1]
    );
}

#[test]
fn an_uncomposited_shell_is_not_put_on_domiciles_own_display() {
    // Two invocations in this repo say what each case needs, and they differ.
    // Presented, the chrome is a Wayland client of Domicile drawn over the
    // apps, so it goes on the display Domicile made for it. Headless, its
    // pixels never leave the page — frames arrive over the socket and the
    // canvas draws them — so it is an ordinary window on whatever display the
    // session already has, which under a headless check is an Xvfb.
    //
    // Setting either unconditionally puts a headless shell on a Wayland display
    // that nothing is compositing, and overrides the display it should have
    // used. `e2e-electron.sh` passes neither and works; `run-native.sh` passes
    // both and works.
    let root = TempDir::new().unwrap();
    let package = install(root.path(), "s", &manifest_for("s", 14));

    let launch = launch_command(
        &resolved(package.clone()),
        &ChromeSession {
            composited: false,
            ..session("/run/c.sock")
        },
        &runtime(),
    )
    .unwrap();

    assert_eq!(
        launch.args,
        [package.join("build/main.js").into_os_string()],
        "a headless shell was given a display flag"
    );
    assert!(
        !launch.env.iter().any(|(key, _)| key == "WAYLAND_DISPLAY"),
        "a headless shell was pointed at Domicile's own display: {:?}",
        launch.env
    );
}
