//! Tests for the error the compositor binary prints when its config fails.
//!
//! `domicile` points users at this message when a desk fails to start, so it
//! must be readable and name the file. These run the binary because only
//! `main` decides how the error is printed. `domicile-config` owns the text.

use std::path::Path;
use std::process::Command;

#[test]
fn a_config_that_will_not_load_is_a_sentence_that_names_its_file() {
    let directory = tempfile::tempdir().expect("a directory");
    let config = directory.path().join("domicile.json");
    // An unknown section, which `deny_unknown_fields` refuses.
    std::fs::write(
        &config,
        r#"{ "compositor": { "nested_size": [800, 600] } }"#,
    )
    .expect("the config");

    let said = refusal(&config);

    assert!(
        said.contains(&config.display().to_string()),
        "it should name the config it could not read: {said}"
    );
    assert!(
        said.contains("`compositor`"),
        "and keep what the parser said about it: {said}"
    );
    assert!(
        !said.contains("\\n"),
        "on the lines it was written on, rather than escaped into one: {said}"
    );
    assert!(
        !said.contains("Parse("),
        "without the variant name a `Debug` print puts around it: {said}"
    );
}

/// A lock PAM service missing from the machine is fatal, and the error says
/// what to declare.
///
/// The config parses; the machine lacks the service. Starting anyway would
/// leave the desk unlocked or behind PAM's `other` stack. This reads the real
/// `/etc/pam.d`, which has no service by this name.
#[test]
fn a_desk_whose_pam_service_the_machine_lacks_says_what_to_declare() {
    let directory = tempfile::tempdir().expect("a directory");
    let config = directory.path().join("domicile.json");
    let service = "domicile-a-service-no-machine-declares";
    std::fs::write(
        &config,
        format!(r#"{{ "lock": {{ "pam_service": "{service}" }} }}"#),
    )
    .expect("the config");

    let said = refusal(&config);

    assert!(
        said.contains(&format!("/etc/pam.d/{service}")),
        "it should name the file PAM would read: {said}"
    );
    assert!(
        said.contains(&format!("security.pam.services.{service} = {{}};")),
        "and what a NixOS machine declares to have one: {said}"
    );
}

/// A `keybindings` table is refused by name, since shells own key bindings
/// and the keys would otherwise do nothing.
#[test]
fn a_table_of_keys_is_a_sentence_that_names_it() {
    let directory = tempfile::tempdir().expect("a directory");
    let config = directory.path().join("domicile.json");
    std::fs::write(
        &config,
        r#"{ "keybindings": { "Meta+Return": "send-shell terminal" } }"#,
    )
    .expect("the config");

    let said = refusal(&config);

    assert!(
        said.contains("keybindings"),
        "it should name the table: {said}"
    );
}

/// Runs the compositor on `config` and returns its stderr.
///
/// The config is read before any socket is bound, so the process exits on
/// its own.
fn refusal(config: &Path) -> String {
    let directory = config.parent().expect("the config is in a directory");
    let ran = Command::new(env!("CARGO_BIN_EXE_domicile-compositor"))
        .arg("--chrome-socket")
        .arg(directory.join("chrome.sock"))
        .arg("--session")
        .arg(directory.join("session.json"))
        .arg("--config")
        .arg(config)
        // Isolate from the test runner's session.
        .env("XDG_RUNTIME_DIR", directory)
        .output()
        .expect("the compositor runs");
    assert!(
        !ran.status.success(),
        "a config that will not load is fatal, and this one exited {}",
        ran.status
    );
    String::from_utf8_lossy(&ran.stderr).into_owned()
}
