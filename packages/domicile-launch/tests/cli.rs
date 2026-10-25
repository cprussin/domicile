//! Tests for parsing the `domicile` command line.

use std::path::PathBuf;

use domicile_launch::cli::{invocation, CliError, Invocation, USAGE};
use domicile_launch::control::{Request, Switch, ThemeChange};
use domicile_launch::power::Power;

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
fn open_takes_one_thing_to_open_as_typed() {
    assert_eq!(
        run(&["open", "~/notes.org"]).unwrap(),
        Invocation::Open {
            target: "~/notes.org".to_string()
        }
    );
    assert_eq!(run(&["open"]), Err(CliError::NothingToOpen));
    assert_eq!(
        run(&["open", "a.txt", "b.txt"]),
        Err(CliError::ExtraToOpen {
            extra: "b.txt".to_string()
        })
    );
}

#[test]
fn open_with_which_asks_what_would_open_it() {
    assert_eq!(
        run(&["open", "--which", "a.txt"]).unwrap(),
        Invocation::Opener {
            target: "a.txt".to_string()
        }
    );
    assert_eq!(run(&["open", "--which"]), Err(CliError::NothingToOpen));
}

#[test]
fn open_with_app_opens_an_address_or_module_as_an_app() {
    assert_eq!(
        run(&["open", "--app", "https://example.com/"]).unwrap(),
        Invocation::OpenAsApp {
            target: "https://example.com/".to_string()
        }
    );
    assert_eq!(run(&["open", "--app"]), Err(CliError::NothingToOpen));
    assert_eq!(
        run(&["open", "--app", "./a.js", "./b.js"]),
        Err(CliError::ExtraToOpen {
            extra: "./b.js".to_string()
        })
    );
}

#[test]
fn install_app_is_the_verb_that_takes_a_site() {
    assert_eq!(
        run(&["install-app", "https://example.com/"]).unwrap(),
        Invocation::InstallApp {
            url: "https://example.com/".to_string()
        }
    );
    assert_eq!(run(&["install-app"]), Err(CliError::NothingToInstall));
    assert_eq!(
        run(&["install-app", "https://a.example", "https://b.example"]),
        Err(CliError::ExtraToInstall {
            extra: "https://b.example".to_string()
        })
    );
}

#[test]
fn uninstall_app_is_the_verb_that_takes_an_app_address() {
    assert_eq!(
        run(&["uninstall-app", "https://example.com/"]).unwrap(),
        Invocation::UninstallApp {
            url: "https://example.com/".to_string()
        }
    );
    assert_eq!(run(&["uninstall-app"]), Err(CliError::NothingToUninstall));
    assert_eq!(
        run(&["uninstall-app", "https://a.example", "https://b.example"]),
        Err(CliError::ExtraToUninstall {
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
fn screen_record_is_a_verb_that_takes_nothing() {
    assert_eq!(
        run(&["screen-record"]).unwrap(),
        Invocation::Ask {
            request: Request::ScreenRecord
        }
    );
    assert_eq!(
        run(&["screen-record", "a.webm"]),
        Err(CliError::Extra {
            verb: "screen-record".to_string(),
            extra: "a.webm".to_string()
        })
    );
}

#[test]
fn power_off_and_reboot_are_verbs_that_take_nothing() {
    assert_eq!(
        run(&["power-off"]),
        Ok(Invocation::Power { power: Power::Off })
    );
    assert_eq!(
        run(&["reboot"]),
        Ok(Invocation::Power {
            power: Power::Reboot
        })
    );
    assert_eq!(
        run(&["reboot", "now"]),
        Err(CliError::Extra {
            verb: "reboot".to_string(),
            extra: "now".to_string()
        })
    );
}

#[test]
fn log_out_is_a_verb_that_takes_nothing() {
    assert_eq!(
        run(&["log-out"]),
        Ok(Invocation::Power {
            power: Power::LogOut
        })
    );
    assert_eq!(
        run(&["log-out", "now"]),
        Err(CliError::Extra {
            verb: "log-out".to_string(),
            extra: "now".to_string()
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
fn disable_while_typing_takes_on_off_toggle_or_nothing() {
    let asked = |to| {
        Ok(Invocation::Ask {
            request: Request::DisableWhileTyping { to },
        })
    };
    assert_eq!(run(&["disable-while-typing"]), asked(None));
    assert_eq!(
        run(&["disable-while-typing", "on"]),
        asked(Some(Switch::On))
    );
    assert_eq!(
        run(&["disable-while-typing", "off"]),
        asked(Some(Switch::Off))
    );
    assert_eq!(
        run(&["disable-while-typing", "toggle"]),
        asked(Some(Switch::Toggle))
    );
}

#[test]
fn disable_while_typing_refuses_anything_else() {
    assert_eq!(
        run(&["disable-while-typing", "maybe"]),
        Err(CliError::NotASwitch {
            said: "maybe".to_string()
        })
    );
    assert_eq!(
        run(&["disable-while-typing", "on", "now"]),
        Err(CliError::Extra {
            verb: "disable-while-typing on".to_string(),
            extra: "now".to_string()
        })
    );
}

#[test]
fn theme_takes_light_dark_toggle_or_nothing() {
    let asked = |to| {
        Ok(Invocation::Ask {
            request: Request::Theme { to },
        })
    };
    assert_eq!(run(&["theme"]), asked(None));
    assert_eq!(run(&["theme", "light"]), asked(Some(ThemeChange::Light)));
    assert_eq!(run(&["theme", "dark"]), asked(Some(ThemeChange::Dark)));
    assert_eq!(run(&["theme", "toggle"]), asked(Some(ThemeChange::Toggle)));
}

#[test]
fn theme_refuses_anything_else() {
    assert_eq!(
        run(&["theme", "blue"]),
        Err(CliError::NotATheme {
            said: "blue".to_string()
        })
    );
    assert_eq!(
        run(&["theme", "dark", "now"]),
        Err(CliError::Extra {
            verb: "theme dark".to_string(),
            extra: "now".to_string()
        })
    );
}

#[test]
fn help_is_asked_for_by_flag_word_or_after_a_verb() {
    for line in [
        &["--help"][..],
        &["-h"],
        &["help"],
        &["theme", "--help"],
        &["send-shell", "-h"],
    ] {
        assert_eq!(run(line), Ok(Invocation::Help), "{line:?}");
    }
}

#[test]
fn help_after_a_verb_s_first_argument_is_that_argument() {
    // `exec` runs whatever follows, flags included.
    assert_eq!(
        run(&["send-shell", "exec", "foot", "--help"]),
        Ok(Invocation::Ask {
            request: Request::SendShell {
                command: vec!["exec".to_string(), "foot".to_string(), "--help".to_string()]
            }
        })
    );
}

#[test]
fn help_takes_no_arguments() {
    assert_eq!(
        run(&["help", "theme"]),
        Err(CliError::Extra {
            verb: "help".to_string(),
            extra: "theme".to_string()
        })
    );
}

#[test]
fn the_usage_lists_every_verb_and_each_one_parses() {
    let listed: Vec<String> = USAGE
        .lines()
        .filter_map(|line| line.trim_start().strip_prefix("domicile "))
        .filter_map(|rest| rest.split_whitespace().next())
        .filter(|word| !word.starts_with(['<', '[', '-']))
        .map(str::to_string)
        .collect();
    for verb in [
        "which-shell",
        "load-shell",
        "open",
        "install-app",
        "uninstall-app",
        "screenshot",
        "send-shell",
        "check-config",
        "disable-while-typing",
        "theme",
        "power-off",
        "reboot",
        "log-out",
        "help",
    ] {
        assert!(
            listed.contains(&verb.to_string()),
            "{verb} is not in --help"
        );
    }
    for verb in &listed {
        assert!(
            !matches!(
                run(&[verb]),
                Ok(Invocation::Run { .. }) | Err(CliError::TooMany { .. })
            ),
            "--help lists {verb}, which is not a verb"
        );
    }
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
