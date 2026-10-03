//! What the builder says, as `domicile` reads it and draws it.

use std::path::PathBuf;

use domicile_launch::build_progress::{bar, heard, Heard, Step};
use domicile_launch::shell_path::Shell;

#[test]
fn each_step_is_read_off_its_line() {
    assert_eq!(
        heard(r#"{"step":"resolving"}"#),
        Heard::Step(Step::Resolving)
    );
    assert_eq!(
        heard(r#"{"packages":["date-fns","zod"],"step":"installing"}"#),
        Heard::Step(Step::Installing(vec!["date-fns".into(), "zod".into()]))
    );
    assert_eq!(heard(r#"{"step":"bundling"}"#), Heard::Step(Step::Bundling));
}

#[test]
fn a_build_ends_with_the_module_or_why_not() {
    assert_eq!(
        heard(r#"{"cached":true,"module":"shell.js","root":"/c/k","step":"built"}"#),
        Heard::Built(Shell {
            root: PathBuf::from("/c/k"),
            module: PathBuf::from("shell.js"),
        })
    );
    assert_eq!(
        heard(r#"{"step":"failed","why":"no file at /x"}"#),
        Heard::Failed("no file at /x".into())
    );
}

#[test]
fn anything_else_is_the_build_s_log() {
    // Panda says how long it took, on the same stdout.
    assert_eq!(
        heard("🐼 info [hrtime] Extracted in (2185.91ms)"),
        Heard::Log("🐼 info [hrtime] Extracted in (2185.91ms)".into())
    );
    assert_eq!(
        heard(r#"{"step":"teleporting"}"#),
        Heard::Log(r#"{"step":"teleporting"}"#.into())
    );
}

#[test]
fn the_bar_fills_with_the_steps() {
    assert_eq!(
        bar(&Step::Resolving),
        "[#--] building the shell: reading what it imports"
    );
    assert_eq!(
        bar(&Step::Installing(vec!["date-fns".into()])),
        "[##-] building the shell: installing date-fns"
    );
    assert_eq!(bar(&Step::Bundling), "[###] building the shell: bundling");
}
