//! The command line, and the one line of the bridge's that is an interface.

use domicile_launch::cli::{invocation, CliError, Invocation};
use domicile_launch::control::Request;

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

#[test]
fn a_verb_is_a_command_for_a_desktop_that_is_already_running() {
    assert_eq!(
        run(&["which-shell"]).unwrap(),
        Invocation::Ask {
            request: Request::WhichShell
        }
    );
}

#[test]
fn a_verb_given_an_argument_is_refused_and_named() {
    // A command is not a shell, so the sentence about one shell being the
    // whole command line is the wrong refusal here — and the word somebody
    // typed is dropped either way if nothing says it was.
    assert_eq!(
        run(&["which-shell", "manganese"]),
        Err(CliError::Extra {
            verb: "which-shell".to_string(),
            extra: "manganese".to_string()
        })
    );
}

#[test]
fn a_shell_whose_name_is_a_verb_is_still_reachable_as_a_path() {
    // THE VERBS WIN, and they are a closed set for exactly this reason: which
    // reading a bare word gets cannot depend on what happens to be on disk
    // beside the person typing it. A shell named after one is run the way
    // every path is.
    assert_eq!(
        run(&["./which-shell"]).unwrap(),
        Invocation::Run {
            shell: "./which-shell".to_string()
        }
    );
}
