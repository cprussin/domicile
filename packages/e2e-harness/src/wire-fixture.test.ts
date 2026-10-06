import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseHostMessage } from "./protocol";

/**
 * Checks that the zod schemas accept every message Rust writes.
 *
 * The fixture is pinned by `domicile-protocol/tests/wire.rs`. A mismatch would
 * otherwise show up only as silently dropped messages.
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
    // Guards against a missing or empty fixture passing vacuously.
    expect(lines.length).toBeGreaterThan(10);
  });

  it.each(lines.map(({ line, number }) => [number, line] as const))(
    "decodes line %i",
    (number, line) => {
      const decoded = parseHostMessage(line);

      // `undefined` means an unknown type, so the definitions have drifted.
      expect(
        decoded,
        `line ${number} is not a message this SDK knows`,
      ).toBeDefined();
      // Catches a line decoded as the wrong message type.
      expect(decoded?.type).toBe(JSON.parse(line).type);
    },
  );
});
