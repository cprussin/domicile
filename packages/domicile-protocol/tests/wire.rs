//! The wire lines both languages have to agree about.
//!
//! `domicile-protocol` is one half of a contract whose other half is
//! `@domicile/chrome-sdk`'s Zod schemas, in another language with its own
//! definitions written by hand. Each side's own tests assert against its own
//! literals, so both can be internally consistent and disagree with each
//! other — and the way that surfaces at runtime is a chrome quietly dropping a
//! message it cannot parse (`chrome-socket.ts` discards what the schema
//! rejects), which looks exactly like a compositor that never sent one.
//!
//! `wire/host-messages.jsonl` is the shared golden file. This asserts Rust
//! writes those exact bytes; `chrome-sdk/src/wire-fixture.test.ts` asserts the
//! SDK reads them. Neither can be changed alone without the other going red.
//!
//! And a variant added to [`HostMessage`] cannot skip the wire: the tags it
//! is checked against come from `serde` itself, so a new one is missing from
//! the fixture the moment it exists. That is the forcing function, and it took
//! two goes to get right — a hand-written list of tags had none, and neither
//! did a hand-written list guarded by an exhaustive `match`, which only forced
//! a *person* to name the variant somewhere and then compared the fixture
//! against a list they had not been made to update.
//!
//! There used to be an end-to-end check of the same thing — a bun probe
//! decoding a real compositor's frames through the SDK — but it needed a whole
//! compositor, and what remains of that shape now skips without weston. This
//! runs in `cargo test` and `turbo test`, which is where it belongs: nothing
//! about two definitions agreeing needs a process.

use domicile_protocol::{HostMessage, PROTOCOL_VERSION};

/// The file, so a failure can name it.
const FIXTURE: &str = "wire/host-messages.jsonl";

#[test]
fn every_fixture_line_is_what_this_crate_writes() {
    for (number, message, line) in messages() {
        let written = serde_json::to_string(&message).expect("it serialises");
        // Byte-for-byte rather than value-for-value. Not for the field order —
        // the reader is `JSON.parse` and a Zod schema, and neither cares — but
        // for what a value-level comparison cannot see: `800.0` where a hand
        // written fixture would say `800`, and `region` *absent* rather than
        // `null`. Both are things the SDK has to be ready for, and both are
        // invisible to a round-trip through this crate's own types.
        assert_eq!(
            written, line,
            "{FIXTURE}:{number} is not what this crate writes"
        );
    }
}

/// And the version in it is the version this crate speaks.
///
/// The one value in the fixture that is not a shape. Left unpinned it survives
/// a `PROTOCOL_VERSION` bump untouched, and a file whose README says its lines
/// are "exactly as the compositor writes it" would be quietly saying the old
/// number — silent rot in the file whose whole job is not to rot silently.
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

/// Every kind of message the chrome is sent appears at least once.
///
/// Without this the fixture rots by omission: a message added to `HostMessage`
/// and to the SDK separately is exactly the drift this file exists to catch,
/// and neither side's own tests would notice.
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

/// Every tag [`HostMessage`] can serialise to, from `serde` itself.
///
/// Asked for by handing it a `type` no variant has: the error it raises to say
/// so enumerates them, and it is derived from the enum rather than written
/// beside it. That is the whole point — every list here that a person had to
/// keep in step went stale, twice, and the file went on claiming otherwise.
///
/// The cost is a dependence on `serde_json`'s wording, and it is paid loudly:
/// a version that phrases this differently panics here rather than quietly
/// returning nothing and passing the test above for want of anything to miss.
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
    // Anchored against the one way this can go wrong quietly. Junk is not it:
    // the coverage test looks for what is *missing* from the fixture, so a
    // mangled tag is a tag no line carries and the test goes red. What passes
    // vacuously is a clean strict subset — a wording change that dropped tags
    // rather than corrupting them, and only then if `displays` is one of the
    // lost. Narrow, but it is the shape with no other guard on it.
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
