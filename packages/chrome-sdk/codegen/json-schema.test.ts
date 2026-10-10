import { describe, expect, it } from "bun:test";

import { parseRootSchema } from "./json-schema";

const ROOT = {
  $defs: {},
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Config",
  type: "object",
};

describe("parseRootSchema", () => {
  it("keeps what types a value and drops constraints TypeScript cannot state", () => {
    expect(
      parseRootSchema({
        ...ROOT,
        properties: {
          scale: { default: 1, format: "uint32", minimum: 0, type: "integer" },
        },
      }),
    ).toEqual({
      $defs: {},
      properties: { scale: { type: "integer" } },
      title: "Config",
      type: "object",
    });
  });

  it("throws on a keyword it does not know, so no type is silently wrong", () => {
    expect(() =>
      parseRootSchema({
        ...ROOT,
        properties: { names: { patternProperties: {}, type: "object" } },
      }),
    ).toThrow("patternProperties");
  });

  it("throws on an object open to other keys", () => {
    expect(() =>
      parseRootSchema({ ...ROOT, additionalProperties: true }),
    ).toThrow("additionalProperties");
  });
});
