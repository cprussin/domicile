//! Checks that this crate writes exactly the lines in
//! `wire/host-messages.jsonl`.
//!
//! `chrome-sdk/src/wire-fixture.test.ts` checks that the SDK's Zod schemas read
//! the same file, so the two hand-written definitions cannot drift apart. A
//! mismatch would otherwise show up only at runtime, as the chrome silently
//! dropping messages it cannot parse. Message tags come from serde itself, so a
//! new [`HostMessage`] variant fails here until the fixture covers it.

use domicile_protocol::{HostMessage, PROTOCOL_VERSION};

/// The fixture path, for failure messages.
const FIXTURE: &str = "wire/host-messages.jsonl";

#[test]
fn every_fixture_line_is_what_this_crate_writes() {
    for (number, message, line) in messages() {
        let written = serde_json::to_string(&message).expect("it serializes");
        // Compare bytes, not values: a value comparison misses `800.0` versus
        // `800` and an absent key versus `null`, both of which the SDK must
        // handle.
        assert_eq!(
            written, line,
            "{FIXTURE}:{number} is not what this crate writes"
        );
    }
}

/// The fixture's `welcome` carries this crate's version.
///
/// Otherwise a `PROTOCOL_VERSION` bump would leave a stale number in it.
#[test]
fn the_welcome_on_the_wire_is_this_crates_version() {
    let welcomed: Vec<u32> = messages()
        .filter_map(|(_, message, _)| match message {
            HostMessage::Welcome { protocol_version } => Some(protocol_version),
            _ => None,
        })
        .collect();

    assert_eq!(
        welcomed,
        vec![PROTOCOL_VERSION],
        "the fixture's welcome has to carry the version this crate speaks"
    );
}

/// Every [`HostMessage`] kind appears in the fixture at least once.
///
/// A message added to both sides separately is the drift this file catches.
#[test]
fn the_fixture_covers_every_host_message() {
    let covered: Vec<String> = lines().map(|(number, line)| tag(number, &line)).collect();

    let missing: Vec<String> = every_kind()
        .into_iter()
        .filter(|wanted| !covered.contains(wanted))
        .collect();
    assert!(
        missing.is_empty(),
        "no line in {FIXTURE} for: {missing:?} — add one, and a case for it in \
         chrome-sdk's wire-fixture test"
    );
}

/// Every tag [`HostMessage`] can serialize to, from `serde` itself.
///
/// Parses an unknown `type` and reads the variant list from serde's error, so
/// the list cannot go stale. Depends on `serde_json`'s error wording, and
/// panics if that changes.
fn every_kind() -> Vec<String> {
    let complaint = serde_json::from_str::<HostMessage>(r#"{"type":"no such thing"}"#)
        .expect_err("no variant is spelled like that")
        .to_string();
    let listed = complaint
        .split_once("expected one of ")
        .unwrap_or_else(|| panic!("serde no longer lists the variants: {complaint}"))
        .1;
    let kinds: Vec<String> = listed
        .split(" at line")
        .next()
        .expect("a split always yields one")
        .split(", ")
        .map(|kind| kind.trim_matches('`').to_string())
        .collect();
    // Guard against a wording change that silently drops tags, which would let
    // the coverage test pass with nothing to check. Malformed tags already fail
    // it.
    assert!(
        kinds.contains(&"displays".to_string()),
        "the tags did not come out of {complaint:?}: {kinds:?}"
    );
    kinds
}

/// The `type` a fixture line carries.
fn tag(number: usize, line: &str) -> String {
    let envelope: serde_json::Value = serde_json::from_str(line).expect("it parses");
    envelope
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_else(|| panic!("{FIXTURE}:{number} has no type"))
        .to_string()
}

/// The fixture's lines, parsed: the line number, the message, and the bytes.
fn messages() -> impl Iterator<Item = (usize, HostMessage, String)> {
    lines().map(|(number, line)| {
        let message: HostMessage = serde_json::from_str(&line)
            .unwrap_or_else(|err| panic!("{FIXTURE}:{number} does not parse here: {err}"));
        (number, message, line)
    })
}

/// The fixture's lines, numbered from one, blank lines dropped.
fn lines() -> impl Iterator<Item = (usize, String)> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("{} cannot be read: {err}", path.display()));
    text.lines()
        .enumerate()
        .map(|(index, line)| (index + 1, line.to_string()))
        .filter(|(_, line)| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .into_iter()
}
