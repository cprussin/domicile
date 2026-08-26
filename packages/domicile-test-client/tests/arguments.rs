//! What the client will and will not be told to open.
//!
//! The window itself needs a compositor to be tested against, and the checks
//! in `scripts/` are what do that. This is the half that does not: every
//! refusal here is one a caller would otherwise meet as a window that is
//! missing, or named something it did not choose.

use std::ffi::OsString;

use domicile_test_client::arguments::{arguments, ArgumentError, Arguments};

/// A command line, as the shell hands one over.
fn given(args: &[&str]) -> Result<Arguments, ArgumentError> {
    arguments(args.iter().map(OsString::from))
}

#[test]
fn a_client_told_nothing_still_opens_a_window() {
    // The common case in `scripts/`: a check needs *a* window and asserts on
    // what the compositor did with it, so the title is the only thing it ever
    // has to say.
    let asked = given(&[]).expect("nothing is a valid thing to say");

    assert_eq!(asked.title, "domicile-test-client");
    assert!(!asked.trace, "a client nobody asked to report stays quiet");
}

#[test]
fn a_title_is_what_a_check_tells_two_windows_apart_by() {
    let asked = given(&["--title", "left"]).expect("a title");

    assert_eq!(asked.title, "left");
}

#[test]
fn a_flag_with_nothing_after_it_is_refused() {
    // Rather than defaulted: `--title $NAME` with `NAME` unset is a caller
    // that meant to name a window, and one named after the next flag along is
    // worse than being told.
    assert_eq!(
        given(&["--title"]),
        Err(ArgumentError::NeedsValue {
            flag: "--title".to_string()
        })
    );
}

#[test]
fn an_empty_value_is_refused_rather_than_used() {
    // The shape an unset shell variable actually takes: the flag is there and
    // its value is the empty string. A window with no name is exactly what a
    // check looking for one by name cannot find.
    assert_eq!(
        given(&["--title", ""]),
        Err(ArgumentError::EmptyValue {
            flag: "--title".to_string()
        })
    );
}

#[test]
fn a_flag_given_twice_is_refused_rather_than_one_of_them_obeyed() {
    assert_eq!(
        given(&["--title", "one", "--title", "two"]),
        Err(ArgumentError::Repeated {
            flag: "--title".to_string()
        })
    );
}

#[test]
fn a_client_can_be_asked_to_report_what_it_sees() {
    // What the checks that assert on the protocol rather than on the picture
    // read, in place of the `WAYLAND_DEBUG` log they used to need one of
    // weston's clients for.
    let asked = given(&["--trace"]).expect("a request to report");

    assert!(asked.trace);
}

#[test]
fn asking_to_report_twice_is_refused_like_any_other_repeat() {
    // A flag with no value still means a caller that thinks it said two
    // things, and this one is a plausible thing to append twice by mistake.
    assert_eq!(
        given(&["--trace", "--trace"]),
        Err(ArgumentError::Repeated {
            flag: "--trace".to_string()
        })
    );
}

#[test]
fn an_argument_this_does_not_know_is_named_rather_than_ignored() {
    // An argument that goes nowhere is a request that silently did not
    // happen, which is the failure the compositor's own command line refuses
    // for the same reason.
    assert_eq!(
        given(&["--fullscreen"]),
        Err(ArgumentError::Unknown {
            argument: "--fullscreen".to_string()
        })
    );
}
