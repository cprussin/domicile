//! The colours both languages have to agree a band is painted in.
//!
//! The compositor reads a band label off the chrome's own pixels, and the
//! chrome paints it — in two languages, from two definitions written by hand.
//! Both can be internally consistent and disagree with each other, and what
//! that looks like at runtime is a compositor that never recognises an answer:
//! it asks for band 0 for ever, the chrome renders band 0 for ever, and the
//! desktop shows one layer of its chrome and no more. Silently, and looking
//! exactly like a shell that declared bands it does not draw.
//!
//! `wire/band-labels.jsonl` is the shared golden file, the same arrangement as
//! `wire/host-messages.jsonl`. This asserts Rust paints those colours;
//! `chrome-sdk/src/band-label.test.ts` asserts the SDK does. Neither can be
//! changed alone without the other going red.

use domicile_protocol::band_label::{css_of, MOST_BANDS};

/// The file, so a failure can name it.
const FIXTURE: &str = "wire/band-labels.jsonl";

fn lines() -> impl Iterator<Item = (usize, String)> {
    include_str!("../wire/band-labels.jsonl")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .enumerate()
        .map(|(index, line)| (index + 1, line.to_owned()))
}

/// The value of `"band"` and `"css"` on one line, read without a JSON parser.
///
/// By hand because the alternative is a dependency this crate does not have —
/// it is serde-only on purpose — and because a fixture whose shape a parser
/// would have to be trusted about is a fixture that can drift into something
/// unreadable and still pass.
fn fields(line: &str) -> (usize, String) {
    let band = line
        .split("\"band\":")
        .nth(1)
        .and_then(|rest| rest.split(',').next())
        .and_then(|digits| digits.trim().parse().ok())
        .unwrap_or_else(|| panic!("{FIXTURE}: no band in {line}"));
    let css = line
        .split("\"css\":\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .unwrap_or_else(|| panic!("{FIXTURE}: no css in {line}"))
        .to_owned();
    (band, css)
}

#[test]
fn every_fixture_line_is_the_colour_this_crate_paints() {
    for (number, line) in lines() {
        let (band, css) = fields(&line);
        assert_eq!(
            css_of(band),
            css,
            "{FIXTURE}:{number} is not the colour this crate paints for band {band}",
        );
    }
}

#[test]
fn the_fixture_covers_every_band_that_fits() {
    // Without this the file rots by omission: a band the label can carry and
    // the fixture does not mention is one the two sides can disagree about
    // with nothing to catch them.
    let covered: Vec<usize> = lines().map(|(_, line)| fields(&line).0).collect();

    assert_eq!(
        covered,
        (0..MOST_BANDS).collect::<Vec<_>>(),
        "{FIXTURE} has to name every band from 0 to {}, in order",
        MOST_BANDS - 1,
    );
}
