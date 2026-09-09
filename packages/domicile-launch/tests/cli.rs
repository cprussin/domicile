//! The command line, and the one line of the bridge's that is an interface.

use domicile_launch::cli::{invocation, CliError, Invocation};

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
        run(&["./dist/shell.js", "simple"]),
        Err(CliError::TooMany {
            extra: "simple".to_string()
        })
    );
}
