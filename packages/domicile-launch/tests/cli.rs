//! The command line, and the one line of the bridge's that is an interface.

use domicile_launch::cli::{invocation, serving_url, CliError, Invocation};

fn run(args: &[&str]) -> Result<Invocation, CliError> {
    invocation(args.iter().map(|arg| (*arg).to_string()))
}

#[test]
fn a_shell_is_the_whole_command_line() {
    assert_eq!(
        run(&["./my-desktop/dist/shell.js"]).unwrap(),
        Invocation::Run {
            shell: "./my-desktop/dist/shell.js".to_string()
        }
    );
}

#[test]
fn nothing_at_all_asks_which_shell() {
    // Refused rather than defaulted. There is no shell this could mean, and a
    // default would start somebody else's desktop.
    assert_eq!(run(&[]), Err(CliError::NoShell));
}

#[test]
fn a_second_argument_is_refused_and_named() {
    // Quietly dropping a word somebody typed is how a run serves one page
    // while they read another on their own command line.
    assert_eq!(
        run(&["./dist", "simple"]),
        Err(CliError::TooMany {
            extra: "simple".to_string()
        })
    );
}

#[test]
fn the_bridge_line_is_read_for_its_url() {
    assert_eq!(
        serving_url("domicile: serving http://127.0.0.1:41234/"),
        Some("http://127.0.0.1:41234/")
    );
}

#[test]
fn any_other_line_the_bridge_says_is_not_a_url() {
    // It logs. Taking the first line for the URL is how a desktop opens a
    // window on a message.
    assert_eq!(serving_url("domicile: waiting for the compositor"), None);
    assert_eq!(serving_url(""), None);
    assert_eq!(serving_url("  domicile: serving http://x/"), None);
}
