//! The command line, and the one line of the bridge's that is an interface.

use std::path::PathBuf;

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
            config: None,
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
    // `--config` is not special here, and that is the assertion: a verb is a
    // question put to a desktop that is already running, and that desktop
    // read its config when it started. Hoisting the flag above this dispatch
    // would hand a config to a process that will not read one -- worse than
    // refused, because it looks like it worked.
    assert_eq!(
        run(&["which-shell", "--config", "/a.json"]),
        Err(CliError::Extra {
            verb: "which-shell".to_string(),
            extra: "--config".to_string()
        })
    );
}

#[test]
fn load_shell_is_the_verb_that_takes_a_shell() {
    // THE FIRST VERB WITH AN ARGUMENT. `which-shell` is a question a desktop
    // answers out of what it already knows; this one says which shell to serve
    // from now on, and that shell is the whole of what it says. Carried as
    // typed rather than resolved: which file a relative path names is a
    // question about the directory the person was standing in, and
    // `shell_path` is what asks it.
    assert_eq!(
        run(&["load-shell", "./my-desktop/dist/shell.js"]).unwrap(),
        Invocation::Load {
            shell: "./my-desktop/dist/shell.js".to_string()
        }
    );
}

#[test]
fn load_shell_with_nothing_to_load_is_refused() {
    // There is no shell this could mean, and the desktop it is put to is
    // already running one: a bare `load-shell` that quietly reloaded that one
    // would be a different command wearing this one's name.
    assert_eq!(run(&["load-shell"]), Err(CliError::NoShellToLoad));
}

#[test]
fn load_shell_takes_one_shell_and_the_extra_word_is_named() {
    // A desktop serves one shell, so a second word is somebody saying two
    // things -- and `--config` is one of the words this catches, which is the
    // rule every verb keeps: the desktop being asked read its config when it
    // started.
    assert_eq!(
        run(&["load-shell", "./dist/shell.js", "./other.js"]),
        Err(CliError::ExtraToLoad {
            extra: "./other.js".to_string()
        })
    );
    assert_eq!(
        run(&["load-shell", "--config", "/a.json"]),
        Err(CliError::ExtraToLoad {
            extra: "/a.json".to_string()
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
            config: None,
            shell: "./which-shell".to_string()
        }
    );
}

#[test]
fn a_config_is_the_other_half_of_a_run() {
    // The monitors, their scales and their turns. Without this the file a
    // shell writes is read by nobody: the compositor takes `--config` and had
    // no way to be given one.
    assert_eq!(
        run(&["./dist/shell.js", "--config", "/etc/domicile/desk.json"]).unwrap(),
        Invocation::Run {
            config: Some(PathBuf::from("/etc/domicile/desk.json")),
            shell: "./dist/shell.js".to_string()
        }
    );
}

#[test]
fn the_config_may_come_before_the_shell() {
    // A run is two values and neither is positional against the other, so the
    // order somebody types them in is not a thing to be right about. This is
    // also the spelling a unit file or a wrapper script reaches for first,
    // where the flags are fixed and the shell is the argument.
    assert_eq!(
        run(&["--config", "/etc/domicile/desk.json", "./dist/shell.js"]).unwrap(),
        Invocation::Run {
            config: Some(PathBuf::from("/etc/domicile/desk.json")),
            shell: "./dist/shell.js".to_string()
        }
    );
}

#[test]
fn a_config_flag_with_nothing_behind_it_is_refused() {
    // Rather than read as "no config", which is a real and different answer:
    // the compositor runs its defaults on a missing flag and refuses a path
    // it cannot load, so guessing here picks one of those for somebody who
    // meant the other.
    assert_eq!(
        run(&["./dist/shell.js", "--config"]),
        Err(CliError::ConfigWithoutPath)
    );
}

#[test]
fn two_configs_are_refused_and_the_second_is_named() {
    // A desktop is one config. Keeping either one quietly is how a desk comes
    // up wearing settings nobody chose, which is the failure this whole file
    // is written against.
    assert_eq!(
        run(&[
            "./dist/shell.js",
            "--config",
            "/a.json",
            "--config",
            "/b.json"
        ]),
        Err(CliError::TwoConfigs {
            second: "/b.json".to_string()
        })
    );
}

#[test]
fn a_shell_is_still_refused_when_only_a_config_was_given() {
    // The flag is the other half of a run, not a run on its own.
    assert_eq!(run(&["--config", "/a.json"]), Err(CliError::NoShell));
}
