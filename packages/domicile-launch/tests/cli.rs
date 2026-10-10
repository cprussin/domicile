//! Tests for parsing the `domicile` command line.

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
            shell: Some("./my-desktop/dist/shell.js".to_string())
        }
    );
}

#[test]
fn nothing_at_all_is_the_shell_the_config_names() {
    // The shell then comes from the config. The run checks that one exists.
    assert_eq!(
        run(&[]),
        Ok(Invocation::Run {
            config: None,
            shell: None
        })
    );
}

#[test]
fn a_second_argument_is_refused_and_named() {
    // Dropping a word silently could serve a shell other than the one typed.
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
    // A verb gets its own error, naming the extra word.
    assert_eq!(
        run(&["which-shell", "manganese"]),
        Err(CliError::Extra {
            verb: "which-shell".to_string(),
            extra: "manganese".to_string()
        })
    );
    // `--config` is refused too: the running desktop already read its config,
    // so accepting the flag would look like it worked when it did nothing.
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
    // The shell is kept as typed. `shell_path` resolves it against the
    // working directory.
    assert_eq!(
        run(&["load-shell", "./my-desktop/dist/shell.js"]).unwrap(),
        Invocation::Load {
            shell: "./my-desktop/dist/shell.js".to_string()
        }
    );
}

#[test]
fn load_shell_with_nothing_to_load_is_refused() {
    // It does not mean "reload the current shell".
    assert_eq!(run(&["load-shell"]), Err(CliError::NoShellToLoad));
}

#[test]
fn load_shell_takes_one_shell_and_the_extra_word_is_named() {
    // A desktop serves one shell. `--config` is refused as with every verb.
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
fn open_url_is_the_verb_that_takes_an_address() {
    // What `BROWSER` runs. The target is kept as typed, like `load-shell`'s.
    assert_eq!(
        run(&["open-url", "https://example.com/a?b=c"]).unwrap(),
        Invocation::Open {
            target: "https://example.com/a?b=c".to_string()
        }
    );
}

#[test]
fn open_url_with_nothing_to_open_is_refused() {
    assert_eq!(run(&["open-url"]), Err(CliError::NothingToOpen));
}

#[test]
fn open_url_takes_one_address_and_the_extra_word_is_named() {
    // A caller passing two addresses expects two windows, so opening one
    // would be wrong.
    assert_eq!(
        run(&["open-url", "https://a.example", "https://b.example"]),
        Err(CliError::ExtraToOpen {
            extra: "https://b.example".to_string()
        })
    );
}

#[test]
fn screenshot_is_the_verb_that_takes_a_file() {
    // Kept as typed; the client makes it absolute.
    assert_eq!(
        run(&["screenshot", "shot.png"]).unwrap(),
        Invocation::Screenshot {
            file: Some("shot.png".to_string())
        }
    );
}

#[test]
fn screenshot_with_no_file_is_the_shells_own() {
    assert_eq!(
        run(&["screenshot"]).unwrap(),
        Invocation::Screenshot { file: None }
    );
}

#[test]
fn screenshot_takes_one_file_and_the_extra_word_is_named() {
    assert_eq!(
        run(&["screenshot", "a.png", "b.png"]),
        Err(CliError::ExtraToSave {
            extra: "b.png".to_string()
        })
    );
}

#[test]
fn send_shell_sends_every_word_after_it_as_the_command() {
    assert_eq!(
        run(&["send-shell", "focus", "right"]),
        Ok(Invocation::Ask {
            request: Request::SendShell {
                command: vec!["focus".to_string(), "right".to_string()]
            }
        })
    );
}

#[test]
fn send_shell_with_no_command_is_refused() {
    assert_eq!(run(&["send-shell"]), Err(CliError::NothingToSend));
}

#[test]
fn a_shell_whose_name_is_a_verb_is_still_reachable_as_a_path() {
    // Verbs always win over a bare word, regardless of what is on disk. A
    // shell with a verb's name is run by path.
    assert_eq!(
        run(&["./which-shell"]).unwrap(),
        Invocation::Run {
            config: None,
            shell: Some("./which-shell".to_string())
        }
    );
}

#[test]
fn a_config_is_the_other_half_of_a_run() {
    // The config is passed through to the compositor.
    assert_eq!(
        run(&["./dist/shell.js", "--config", "/etc/domicile/desk.json"]).unwrap(),
        Invocation::Run {
            config: Some(PathBuf::from("/etc/domicile/desk.json")),
            shell: Some("./dist/shell.js".to_string())
        }
    );
}

#[test]
fn the_config_may_come_before_the_shell() {
    // Order does not matter. Wrapper scripts often put fixed flags first.
    assert_eq!(
        run(&["--config", "/etc/domicile/desk.json", "./dist/shell.js"]).unwrap(),
        Invocation::Run {
            config: Some(PathBuf::from("/etc/domicile/desk.json")),
            shell: Some("./dist/shell.js".to_string())
        }
    );
}

#[test]
fn a_config_flag_with_nothing_behind_it_is_refused() {
    // Refused rather than read as "no config". A bare `--config` could mean
    // either the defaults or a missing path.
    assert_eq!(
        run(&["./dist/shell.js", "--config"]),
        Err(CliError::ConfigWithoutPath)
    );
}

#[test]
fn two_configs_are_refused_and_the_second_is_named() {
    // Keeping either silently could apply settings nobody chose.
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
fn a_config_alone_is_a_run_on_the_shell_it_names() {
    assert_eq!(
        run(&["--config", "/a.json"]),
        Ok(Invocation::Run {
            config: Some(PathBuf::from("/a.json")),
            shell: None
        })
    );
}

#[test]
fn check_config_is_the_verb_that_takes_a_config() {
    assert_eq!(
        run(&["check-config", "domicile.json"]).unwrap(),
        Invocation::Check {
            config: PathBuf::from("domicile.json")
        }
    );
}

#[test]
fn check_config_with_no_config_is_refused() {
    assert_eq!(run(&["check-config"]), Err(CliError::NothingToCheck));
}

#[test]
fn check_config_takes_one_config_and_the_extra_word_is_named() {
    assert_eq!(
        run(&["check-config", "a.json", "b.json"]),
        Err(CliError::ExtraToCheck {
            extra: "b.json".to_string()
        })
    );
}
