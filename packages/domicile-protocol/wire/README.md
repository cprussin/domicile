# The wire

`host-messages.jsonl` is the golden file for messages the compositor sends to
a chrome. Each line is one message, byte for byte as the compositor
writes it.

Rust and TypeScript define these messages separately, by hand. Both sides test
against this file so they can't drift apart. A mismatch would otherwise show
up only at runtime: `chrome-socket.ts` silently drops any message its schema
rejects.

## Tests

- **`packages/domicile-protocol/tests/wire.rs`**: checks that Rust writes each
  line byte for byte. This catches details a value comparison misses, like
  `800.0` vs `800`, or `"size":null` vs an absent key.
- **`packages/e2e-harness/src/wire-fixture.test.ts`**: checks that the e2e
  harness's Zod schemas parse each line.

## Rules the tests enforce

- Every `HostMessage` variant has a line. A new variant without one fails
  `the_fixture_covers_every_host_message`, which names the missing tag.
- `protocol_version` in the `welcome` line equals `PROTOCOL_VERSION`.
- Changing a field means editing its line. Both sides fail until they match.
