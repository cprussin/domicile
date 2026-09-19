//! What a component said on stderr, kept so the run can say it again.
//!
//! The behavior under test is a tail with a purpose, so these are about which
//! lines survive it rather than about a buffer: a desk that would not come up
//! is read at the bottom of the terminal, and what has to be there is the
//! compositor's own complaint.

use domicile_launch::heard::Heard;

/// A cap small enough to reach in a test, and not the one the run uses --
/// which is `bin/domicile.rs`'s to choose and to argue.
const KEEP: usize = 3;

#[test]
fn a_component_that_said_nothing_has_nothing_to_repeat() {
    // The ordinary run, and the reason this is an `Option`: every desktop that
    // came up and was used ends here, and a heading over an empty quote is
    // worse than no heading.
    let heard = Heard::new(KEEP);
    assert_eq!(heard.said(), None);
}

#[test]
fn what_it_said_comes_back_on_the_lines_it_was_said_on() {
    // The whole point of the reprint. toml underlines the key it could not
    // read, and that drawing is three lines of the six -- a repeat that joined
    // them would be the `Debug` print this replaced all over again.
    let mut heard = Heard::new(20);
    for line in [
        "domicile-compositor: the config at /home/me/domicile.toml could not be loaded:",
        "invalid config syntax: TOML parse error at line 1, column 2",
        "  |",
        "1 | [compositor]",
        "  |  ^^^^^^^^^^",
        "unknown field `compositor`, expected `input` or `output`",
    ] {
        heard.line(line);
    }

    assert_eq!(
        heard.said().as_deref(),
        Some(
            "domicile-compositor: the config at /home/me/domicile.toml could not be loaded:\n\
             invalid config syntax: TOML parse error at line 1, column 2\n\
             \x20 |\n\
             1 | [compositor]\n\
             \x20 |  ^^^^^^^^^^\n\
             unknown field `compositor`, expected `input` or `output`"
        )
    );
}

#[test]
fn only_the_last_of_a_component_that_would_not_stop_talking() {
    // A desktop that came up, was used and then panicked has a backtrace on
    // this stream, and reprinting all of it would bury the reprint the way the
    // original was buried. The last lines rather than the first because this
    // is about how a component *ended*.
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
    // Not the same as saying nothing, and it reads the same to whoever is
    // looking at the terminal. The compositor's complaint ends in a newline,
    // so a blank line arrives after every real one.
    let mut heard = Heard::new(KEEP);
    heard.line("");
    heard.line("   ");

    assert_eq!(heard.said(), None);
}

#[test]
fn the_blank_lines_around_what_it_said_are_not_repeated_with_it() {
    // The trailing newline of the complaint, again -- a reprint that ended in
    // a blank line would put one between the quote and whatever the shell
    // prints next, which reads as the quote having more to it.
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
