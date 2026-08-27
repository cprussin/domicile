# The wire

Two golden files, for the two things the compositor and the chrome SDK have to
agree about without either being able to check the other at build time.

## `host-messages.jsonl`

One JSON line per message, exactly as the compositor writes it, and it is read
from both languages:

- `packages/domicile-protocol/tests/wire.rs` asserts Rust *writes* these bytes —
  serialising each parsed line back and comparing. Byte-for-byte rather than
  value-for-value, for what a round-trip through Rust's own types cannot see:
  `800.0` where a hand-written fixture would say `800`, and `region` *absent*
  rather than `null`. Both are things the SDK has to be ready for.
- `packages/chrome-sdk/src/wire-fixture.test.ts` asserts the SDK's Zod schemas
  *read* them.

Why a file rather than a test each: the two definitions are written by hand in
two languages, so each side's own tests can pass against its own literals while
the two disagree with each other. What that looks like at runtime is a chrome
silently dropping a message — `chrome-socket.ts` discards whatever the schema
rejects — which is indistinguishable from a compositor that never sent one.

A new `HostMessage` variant cannot skip this file: `wire.rs` asks `serde` which
tags the enum has — by handing it one no variant answers to and reading the
complaint — so a variant added and nothing else fails
`the_fixture_covers_every_host_message`, naming its tag. Changing a field means
editing the line, and both sides go red until it matches. `protocol_version` in
the `welcome` line is pinned to `PROTOCOL_VERSION` too, so a bump cannot leave
a stale number sitting in a file that claims to be the wire.

That is the whole mechanism: neither language can move alone.

## `band-labels.jsonl`

One line per band, saying the colour a chrome paints to tell the compositor
which band the frame it is committing is. The page cannot label the stream its
commit rides on — that connection belongs to Chromium rather than to the page —
so it labels the *picture*, in the top-left pixel, and the compositor reads it
back. See `src/band_label.rs`.

- `tests/band_labels.rs` asserts Rust reads those colours as those bands.
- `packages/chrome-sdk/src/band-label.test.ts` asserts the SDK paints them.

Here the failure the file exists to catch is quieter than a dropped message: a
compositor that does not recognise an answer asks for band 0 for ever, the
chrome renders band 0 for ever, and the desktop shows one layer of its chrome
and no more — which looks exactly like a shell that declared bands it does not
draw. `the_fixture_covers_every_band_that_fits` is the other half, so a band
the label can carry cannot be left out of the file.
