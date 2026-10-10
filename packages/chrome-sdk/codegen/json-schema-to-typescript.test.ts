import { describe, expect, it } from "bun:test";

import type { JsonSchema } from "./json-schema";
import { jsonSchemaToTypeScript } from "./json-schema-to-typescript";

const HEADER = ["Generated."];

const emit = (
  root: JsonSchema,
  defs: Readonly<Record<string, JsonSchema>> = {},
): string =>
  jsonSchemaToTypeScript(
    { ...root, $defs: defs, title: "Config" },
    { header: HEADER },
  );

/** The TypeScript type `schema` emits, as the root's only property. */
const typeOf = (schema: JsonSchema): string => {
  const emitted = emit({
    properties: { value: schema },
    required: ["value"],
    type: "object",
  });
  const match = /^ {2}value: (.*);\n\};/ms.exec(emitted);
  if (match?.[1] === undefined) {
    throw new Error(`no property in ${emitted}`);
  } else {
    return match[1];
  }
};

describe("jsonSchemaToTypeScript", () => {
  it("starts with the header", () => {
    expect(emit({ type: "object" })).toStartWith("// Generated.\n");
  });

  it("names the root by its title, with its description", () => {
    expect(
      emit({ description: "The config.\n\nAll of it.", type: "object" }),
    ).toContain(
      "/**\n * The config.\n *\n * All of it.\n */\nexport type Config = {};",
    );
  });

  it("makes a property optional unless it is required, with its description", () => {
    expect(
      emit({
        properties: {
          $schema: { type: "string" },
          name: { description: "Its name.", type: "string" },
          "rotate-90": { type: "boolean" },
        },
        required: ["name"],
        type: "object",
      }),
    ).toContain(`export type Config = {
  $schema?: string;
  /** Its name. */
  name: string;
  "rotate-90"?: boolean;
};`);
  });

  it("emits each definition as an exported type, in order", () => {
    expect(
      emit(
        { properties: { mode: { $ref: "#/$defs/Mode" } }, type: "object" },
        {
          Mode: { description: "A mode.", enum: ["dark", "light"] },
          Size: { type: "integer" },
        },
      ),
    ).toEndWith(`export type Config = {
  mode?: Mode;
};

/** A mode. */
export type Mode = "dark" | "light";

export type Size = number;
`);
  });

  describe("types", () => {
    it.each<[string, JsonSchema, string]>([
      ["a string", { type: "string" }, "string"],
      ["an integer", { type: "integer" }, "number"],
      ["a number", { type: "number" }, "number"],
      ["a boolean", { type: "boolean" }, "boolean"],
      ["a nullable type", { type: ["string", "null"] }, "string | null"],
      ["a reference", { $ref: "#/$defs/Mode" }, "Mode"],
      [
        "an enum",
        { enum: ["normal", "high"], type: "string" },
        '"normal" | "high"',
      ],
      ["a constant", { const: "dark", type: "string" }, '"dark"'],
      [
        "one of several",
        { oneOf: [{ enum: ["light"] }, { const: "dark" }] },
        '"light" | "dark"',
      ],
      [
        "any of several",
        { anyOf: [{ $ref: "#/$defs/Color" }, { type: "null" }] },
        "Color | null",
      ],
      ["an array", { items: { type: "string" }, type: "array" }, "string[]"],
      [
        "an array of a union",
        { items: { type: ["string", "null"] }, type: "array" },
        "(string | null)[]",
      ],
      [
        "a tuple",
        {
          prefixItems: [{ type: "integer" }, { type: "integer" }],
          type: ["array", "null"],
        },
        "[number, number] | null",
      ],
      [
        "an object",
        { properties: { name: { type: "string" } }, type: "object" },
        "{\n    name?: string;\n  }",
      ],
    ])("emits %s", (_, schema, typescript) => {
      expect(typeOf(schema)).toBe(typescript);
    });
  });

  it("throws on a reference outside the definitions", () => {
    expect(() => typeOf({ $ref: "other.json#/Mode" })).toThrow(
      "other.json#/Mode",
    );
  });

  it("throws on a schema that names no type", () => {
    expect(() => typeOf({ description: "Anything." })).toThrow("no type");
  });
});
