import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseHostMessage } from "./protocol";

/**
 * The other half of `domicile-protocol/tests/wire.rs`.
 *
 * Both sides of this protocol are written by hand, in different languages,
 * and each one's own tests assert against its own literals — so both can be
 * internally consistent and disagree with each other. What that looks like at
 * runtime is a chrome dropping a message it cannot parse (`chrome-socket.ts`
 * discards whatever the schema rejects), which from the page is
 * indistinguishable from a compositor that never sent one.
 *
 * So this reads the bytes Rust is pinned to writing and requires the schemas
 * to accept every one. It needs no compositor: the thing under test is two
 * definitions agreeing, and the fixture is what they agree about.
 */
const FIXTURE = path.join(
  import.meta.dir,
  "../../domicile-protocol/wire/host-messages.jsonl",
);

const lines = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => line.trim() !== "");

describe("the wire fixture", () => {
  it("has lines in it", () => {
    // Otherwise every assertion below passes over an empty list, and a moved
    // or emptied fixture reads as a green suite.
    expect(lines.length).toBeGreaterThan(10);
  });

  it.each(lines.map(({ line, number }) => [number, line] as const))(
    "decodes line %i",
    (number, line) => {
      const decoded = parseHostMessage(line);

      // `undefined` is the SDK's "a newer host sent something I don't know",
      // which for a line this repo generated means the two definitions have
      // drifted apart rather than that anything is newer.
      expect(
        decoded,
        `line ${number} is not a message this SDK knows`,
      ).toBeDefined();
      // And the type survives, so a schema that decoded it as something else
      // is caught too.
      expect(decoded?.type).toBe(JSON.parse(line).type);
    },
  );
});
