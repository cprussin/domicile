//! The command line a shell starts the compositor with.

use std::ffi::OsString;
use std::path::PathBuf;

use domicile_launch::arguments::{arguments, ArgumentError, Arguments};

fn parse<const N: usize>(args: [&str; N]) -> Result<Arguments, ArgumentError> {
    arguments(args.into_iter().map(OsString::from))
}

fn the_required_two() -> [&'static str; 4] {
    [
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
    ]
}

#[test]
fn the_two_paths_the_shell_names_are_read_back() {
    let parsed = parse(the_required_two()).expect("both are there");

    assert_eq!(parsed.chrome_socket, PathBuf::from("/run/chrome.sock"));
    assert_eq!(parsed.session, PathBuf::from("/run/session.json"));
}

/// Nothing else is defaulted from the environment, so a run with only the two
/// required paths is a complete description of what the compositor will do.
#[test]
fn without_the_rest_there_is_no_config_and_no_window() {
    let parsed = parse(the_required_two()).expect("both are there");

    assert_eq!(parsed.config, None);
    assert!(!parsed.present);
}

#[test]
fn a_config_and_a_window_are_read_when_given() {
    let parsed = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
        "--config",
        "/run/config.json",
        "--present",
    ])
    .expect("all of them are there");

    assert_eq!(parsed.config, Some(PathBuf::from("/run/config.json")));
    assert!(parsed.present);
    // Off unless asked for, which is the whole of what makes advertising a
    // protocol this compositor does not implement defensible: an experiment
    // that cannot be reached by a desktop.
    assert!(!parsed.experiment_augmenter);
}

/// The augmenter experiment, which is off by default and takes no value.
///
/// It advertises `surface_augmenter` and honours none of it, so it is only
/// ever a measurement — see `Arguments::experiment_augmenter`. The default is
/// the load-bearing half and the test above pins it; this one pins that asking
/// works and that asking *with a value* does not, the same way `--present`
/// does, since a wrapper writing `--experiment-augmenter=false` and getting an
/// experiment is the trap that flag shape exists to avoid.
#[test]
fn the_augmenter_experiment_is_asked_for_and_never_valued() {
    let parsed = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
        "--experiment-augmenter",
    ])
    .expect("the experiment is asked for");
    assert!(parsed.experiment_augmenter);

    let refused = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
        "--experiment-augmenter=false",
    ])
    .expect_err("--experiment-augmenter takes no value");
    assert_eq!(
        refused,
        ArgumentError::UnwantedValue {
            flag: "--experiment-augmenter".into()
        }
    );
}

/// `--flag=value` as well as `--flag value`: a wrapper writing the command line
/// picks whichever reads better, and having one of them mean something else is
/// a trap rather than a rule.
#[test]
fn a_value_may_be_joined_to_its_flag() {
    let parsed = parse([
        "--chrome-socket=/run/chrome.sock",
        "--session=/run/session.json",
        "--config=/run/config.json",
    ])
    .expect("all of them are there");

    assert_eq!(parsed.chrome_socket, PathBuf::from("/run/chrome.sock"));
    assert_eq!(parsed.session, PathBuf::from("/run/session.json"));
    assert_eq!(parsed.config, Some(PathBuf::from("/run/config.json")));
}

#[test]
fn a_missing_chrome_socket_is_refused() {
    let err = parse(["--session", "/run/session.json"]).expect_err("nothing serves the chrome");

    assert_eq!(
        err,
        ArgumentError::Missing {
            flag: "--chrome-socket"
        }
    );
}

#[test]
fn a_missing_session_is_refused() {
    let err = parse(["--chrome-socket", "/run/chrome.sock"])
        .expect_err("nothing would learn the displays");

    assert_eq!(err, ArgumentError::Missing { flag: "--session" });
}

#[test]
fn a_flag_with_nothing_after_it_is_refused() {
    let err = parse(["--chrome-socket"]).expect_err("there is no path");

    assert_eq!(
        err,
        ArgumentError::NeedsValue {
            flag: "--chrome-socket".into()
        }
    );
}

/// An empty value is a typo that reaches much further than the command line: a
/// socket bound at `""` fails somewhere else entirely.
#[test]
fn an_empty_value_is_refused() {
    let err = parse(["--chrome-socket=", "--session", "/run/session.json"])
        .expect_err("the socket has no name");

    assert_eq!(
        err,
        ArgumentError::EmptyValue {
            flag: "--chrome-socket".into()
        }
    );
}

/// Not ignored: an argument nothing reads is a request that silently did not
/// happen, and the compositor's whole command line comes from a program.
#[test]
fn an_argument_nothing_reads_is_refused() {
    let err = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--shell",
        "manganese",
    ])
    .expect_err("--shell is gone");

    assert_eq!(
        err,
        ArgumentError::Unknown {
            argument: "--shell".into()
        }
    );
}

/// A flag that takes no value must not be handed one: the value goes nowhere,
/// and the compositor comes up in a state the shell did not ask for.
#[test]
fn a_value_attached_to_present_is_refused() {
    let err = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
        "--present=false",
    ])
    .expect_err("--present takes no value");

    assert_eq!(
        err,
        ArgumentError::UnwantedValue {
            flag: "--present".into()
        }
    );
}

/// The same rule from the other side: a program that wrote a flag twice meant
/// one of them, and nothing here can tell which.
#[test]
fn a_flag_given_twice_is_refused() {
    let err = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
        "--config",
        "/run/one.json",
        "--config",
        "/run/two.json",
    ])
    .expect_err("which config was meant?");

    assert_eq!(
        err,
        ArgumentError::Repeated {
            flag: "--config".into()
        }
    );
}

#[test]
fn present_may_still_be_given_twice_over() {
    // Not a special case for `--present`: it lands in the same table as the
    // rest, so saying it twice is the same mistake.
    let err = parse([
        "--chrome-socket",
        "/run/chrome.sock",
        "--session",
        "/run/session.json",
        "--present",
        "--present",
    ])
    .expect_err("said twice");

    assert_eq!(
        err,
        ArgumentError::Repeated {
            flag: "--present".into()
        }
    );
}
