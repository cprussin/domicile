//! What a compositor started on a config it cannot read says before it stops.
//!
//! IT IS THE ONLY THING A DESK THAT WILL NOT COME UP HAS TO GO ON. `domicile`
//! starts a desktop five times and says each time that the compositor "said
//! why above", so what is above had better be a sentence. It was not: `main`
//! handed the error back to Rust's own `Termination`, which prints it with
//! `Debug` — the variant name wrapped around it and every newline of the span
//! toml had underlined escaped to a `\n`, one unreadable line in the middle of
//! Chromium's startup log, not naming the file it was about.
//!
//! The binary rather than a function, because that print is what `Debug` got
//! wrong and nothing under `main` can see it. `domicile-config` owns the
//! sentence itself.

use std::path::Path;
use std::process::Command;

#[test]
fn a_config_that_will_not_load_is_a_sentence_that_names_its_file() {
    let directory = tempfile::tempdir().expect("a directory");
    let config = directory.path().join("domicile.toml");
    // The shape that sent a real desk into the restart loop: a section that
    // was a setting one release ago, which `deny_unknown_fields` refuses.
    std::fs::write(&config, "[compositor]\nnested_size = [800, 600]\n").expect("the config");

    let said = refusal(&config);

    assert!(
        said.contains(&config.display().to_string()),
        "it should name the config it could not read: {said}"
    );
    assert!(
        said.contains("`compositor`"),
        "and keep what toml said about it: {said}"
    );
    assert!(
        !said.contains("\\n"),
        "on the lines toml wrote them on, rather than escaped into one: {said}"
    );
    assert!(
        !said.contains("Parse("),
        "without the variant name a `Debug` print puts around it: {said}"
    );
}

/// A desk whose lock is a PAM service the machine does not have is a desk that
/// does not come up, and the sentence says what the machine has to declare.
///
/// **THE SAME FILE PARSES, AND THAT IS WHY THIS IS HERE.** Nothing about the
/// config is wrong; what is missing is the machine's half, which a home-manager
/// module cannot declare. Coming up anyway would be one of two quiet failures —
/// a desk with no lock, or one behind PAM's `other` stack — so it stops, on the
/// real `/etc/pam.d`, which no machine fills with this name.
#[test]
fn a_desk_whose_pam_service_the_machine_lacks_says_what_to_declare() {
    let directory = tempfile::tempdir().expect("a directory");
    let config = directory.path().join("domicile.toml");
    let service = "domicile-a-service-no-machine-declares";
    std::fs::write(&config, format!("[lock]\npam_service = \"{service}\"\n")).expect("the config");

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

/// Start a compositor on `config`, and take what it said before it stopped.
///
/// The other two flags are required and are not what is under test; they name
/// paths in the same directory so nothing is left behind when it does not get
/// far enough to bind them. Nothing here waits: the config is read before any
/// socket is bound, so a compositor given a bad one exits on its own.
fn refusal(config: &Path) -> String {
    let directory = config.parent().expect("the config is in a directory");
    let ran = Command::new(env!("CARGO_BIN_EXE_domicile-compositor"))
        .arg("--chrome-socket")
        .arg(directory.join("chrome.sock"))
        .arg("--session")
        .arg(directory.join("session.json"))
        .arg("--config")
        .arg(config)
        // Its own, so nothing this reaches for is the runner's own session.
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
