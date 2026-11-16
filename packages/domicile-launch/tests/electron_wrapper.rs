//! What `domicile open --electron` takes from an app's wrapper scripts: the
//! environment and arguments they give the Electron program they end in.

use std::fs;
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::electron_wrapper::{through_wrappers, Launch, WrapperError};

fn write(root: &Path, path: &str, text: &str) -> PathBuf {
    let at = root.join(path);
    fs::create_dir_all(at.parent().expect("a parent")).unwrap();
    fs::write(&at, text).unwrap();
    fs::set_permissions(&at, fs::Permissions::from_mode(0o755)).unwrap();
    fs::canonicalize(at).unwrap()
}

fn bash() -> String {
    String::from_utf8(
        std::process::Command::new("sh")
            .args(["-c", "command -v bash"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string()
}

/// An install as a bundled app ships: its binary beside `resources/`, which
/// never runs, as the wrapper's exec stops before it.
fn bundled(root: &Path) -> (PathBuf, PathBuf) {
    write(root, "opt/Claude/resources/app.asar", "asar");
    let binary = write(root, "opt/Claude/claude", "\x7fELF never run");
    (binary, root.join("opt/Claude/resources"))
}

const WAIT: Duration = Duration::from_secs(10);

fn env_of<'a>(launch: &'a Launch, name: &str) -> Option<&'a str> {
    launch
        .env
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

#[test]
fn a_wrappers_environment_and_flags_reach_the_app() {
    let root = tempfile::tempdir().unwrap();
    let (binary, resources) = bundled(root.path());
    let wrapper = write(
        root.path(),
        "bin/claude",
        &format!(
            "#! {} -e\nPATH=/opt/qemu/bin${{PATH:+:$PATH}}\nexport PATH\n\
             export LD_PRELOAD=/lib/libsqlcipher.so\n\
             exec -a \"$0\" \"{}\" --password-store=gnome-libsecret \"$@\"\n",
            bash(),
            binary.display()
        ),
    );

    let launch = through_wrappers(
        &[wrapper.display().to_string(), "-u".into()],
        &resources,
        Path::new(env!("CARGO_BIN_EXE_domicile")),
        WAIT,
    )
    .unwrap();

    assert_eq!(
        launch.args,
        vec!["--password-store=gnome-libsecret".to_string(), "-u".into()]
    );
    assert_eq!(env_of(&launch, "LD_PRELOAD"), Some("/lib/libsqlcipher.so"));
    assert!(env_of(&launch, "PATH")
        .unwrap()
        .starts_with("/opt/qemu/bin:"));
    assert_eq!(env_of(&launch, "BASH_ENV"), None);
    assert_eq!(env_of(&launch, "DOMICILE_ELECTRON_RECORDER"), None);
    // What the desk gave `domicile open` reaches the app too.
    assert_eq!(
        env_of(&launch, "HOME"),
        std::env::var("HOME").ok().as_deref()
    );
}

#[test]
fn every_wrapper_in_a_chain_has_its_say() {
    // As nixpkgs wraps Element: a wrapper adding flags, one preloading a
    // library, then Electron's own, given the app's archive.
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "element/share/element/app.asar", "asar");
    let electron = write(
        root.path(),
        "electron/libexec/electron",
        "\x7fELF never run",
    );
    let electron_wrapper = write(
        root.path(),
        "electron/bin/electron",
        &format!(
            "#! {} -e\nexport CHROME_DEVEL_SANDBOX=/sandbox\nexec \"{}\" \"$@\"\n",
            bash(),
            electron.display()
        ),
    );
    let unwrapped = write(
        root.path(),
        "element/bin/.element-desktop-wrapped",
        &format!(
            "#! {} -e\nexport LD_PRELOAD=/lib/libsqlcipher.so\n\
             exec -a \"$0\" \"{}\" {} \"$@\"\n",
            bash(),
            electron_wrapper.display(),
            root.path().join("element/share/element/app.asar").display(),
        ),
    );
    let wrapper = write(
        root.path(),
        "with-flags/bin/element-desktop",
        &format!(
            "#! {} -e\nexec \"{}\" --ozone-platform-hint=auto \"$@\"\n",
            bash(),
            unwrapped.display()
        ),
    );

    let launch = through_wrappers(
        &[wrapper.display().to_string(), "--hidden".into()],
        &fs::canonicalize(root.path().join("element/share/element")).unwrap(),
        Path::new(env!("CARGO_BIN_EXE_domicile")),
        WAIT,
    )
    .unwrap();

    // The archive is the app, not one of its arguments.
    assert_eq!(
        launch.args,
        vec!["--ozone-platform-hint=auto".to_string(), "--hidden".into()]
    );
    assert_eq!(env_of(&launch, "LD_PRELOAD"), Some("/lib/libsqlcipher.so"));
    assert_eq!(env_of(&launch, "CHROME_DEVEL_SANDBOX"), Some("/sandbox"));
}

#[test]
fn a_program_that_is_no_bash_script_has_no_wrapper_to_follow() {
    let root = tempfile::tempdir().unwrap();
    let (binary, resources) = bundled(root.path());

    assert_eq!(
        through_wrappers(
            &[binary.display().to_string()],
            &resources,
            Path::new(env!("CARGO_BIN_EXE_domicile")),
            WAIT
        ),
        Err(WrapperError::NotBash {
            program: binary.display().to_string()
        })
    );
}

#[test]
fn a_wrapper_that_never_reaches_the_app_says_so() {
    let root = tempfile::tempdir().unwrap();
    let (_, resources) = bundled(root.path());
    let wrapper = write(
        root.path(),
        "bin/claude",
        &format!("#! {}\necho no app here\nexit 4\n", bash()),
    );

    assert!(matches!(
        through_wrappers(
            &[wrapper.display().to_string()],
            &resources,
            Path::new(env!("CARGO_BIN_EXE_domicile")),
            WAIT
        ),
        Err(WrapperError::NoLaunch { .. })
    ));
}

#[test]
fn a_wrapper_ending_in_some_other_program_says_so() {
    let root = tempfile::tempdir().unwrap();
    let (_, resources) = bundled(root.path());
    let other = write(root.path(), "bin/other", "\x7fELF never run");
    let wrapper = write(
        root.path(),
        "bin/claude",
        &format!("#! {}\nexec \"{}\" \"$@\"\n", bash(), other.display()),
    );

    assert!(matches!(
        through_wrappers(
            &[wrapper.display().to_string()],
            &resources,
            Path::new(env!("CARGO_BIN_EXE_domicile")),
            WAIT
        ),
        Err(WrapperError::NotTheApp { .. })
    ));
}
