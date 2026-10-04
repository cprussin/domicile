//! Tail of a component's stderr, reprinted when the run fails.
//!
//! The tests check which lines survive, because the compositor's own error must
//! be at the bottom of the terminal.

use domicile_launch::heard::Heard;

/// A cap small enough to reach in a test. `bin/domicile.rs` sets the run's cap.
const KEEP: usize = 3;

#[test]
fn a_component_that_said_nothing_has_nothing_to_repeat() {
    // The usual case. A heading over an empty quote is worse than no heading.
    let heard = Heard::new(KEEP);
    assert_eq!(heard.said(), None);
}

#[test]
fn what_it_said_comes_back_on_the_lines_it_was_said_on() {
    // A panic backtrace spans several indented lines. Joining them would make
    // it unreadable.
    let mut heard = Heard::new(20);
    for line in [
        "thread 'main' panicked at src/main.rs:10:5:",
        "the layout's extent is validated before a desktop is built",
        "stack backtrace:",
        "   0: rust_begin_unwind",
        "   1: core::panicking::panic_fmt",
    ] {
        heard.line(line);
    }

    assert_eq!(
        heard.said().as_deref(),
        Some(
            "thread 'main' panicked at src/main.rs:10:5:\n\
             the layout's extent is validated before a desktop is built\n\
             stack backtrace:\n\
             \x20  0: rust_begin_unwind\n\
             \x20  1: core::panicking::panic_fmt"
        )
    );
}

#[test]
fn only_the_last_of_a_component_that_would_not_stop_talking() {
    // Keep the last lines because they show how the component ended. A full
    // backtrace would bury the reprint.
    let mut heard = Heard::new(KEEP);
    for line in 0..(KEEP + 10) {
        heard.line(&format!("line {line}"));
    }

    let said = heard.said().expect("it said something");
    let lines: Vec<&str> = said.lines().collect();
    assert_eq!(lines.len(), KEEP, "kept {} lines", lines.len());
    assert_eq!(lines.first(), Some(&"line 10"));
    assert_eq!(
        lines.last().copied(),
        Some(format!("line {}", KEEP + 9)).as_deref()
    );
}

#[test]
fn a_component_that_only_ever_printed_blank_lines_has_nothing_to_repeat() {
    // Reads the same as saying nothing. The compositor's error ends in a
    // newline, so blank lines follow real ones.
    let mut heard = Heard::new(KEEP);
    heard.line("");
    heard.line("   ");

    assert_eq!(heard.said(), None);
}

#[test]
fn the_blank_lines_around_what_it_said_are_not_repeated_with_it() {
    // A trailing blank line would read as part of the quote.
    let mut heard = Heard::new(KEEP);
    heard.line("");
    heard.line("the config could not be loaded:");
    heard.line("unknown field `compositor`");
    heard.line("");

    assert_eq!(
        heard.said().as_deref(),
        Some("the config could not be loaded:\nunknown field `compositor`")
    );
}
