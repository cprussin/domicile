import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import {
  parseDocument,
  serialize,
  valueAt,
  withValue,
} from "./config-document";

describe(parseDocument, () => {
  it("reads a JSON object", () => {
    expect(parseDocument('{"theme":{"mode":"light"}}')).toEqual(
      Ok({ theme: { mode: "light" } }),
    );
  });

  it("says why text is not a config", () => {
    expect(parseDocument("{").isErr()).toBe(true);
    expect(parseDocument("[1]")).toEqual(Err("A config is a JSON object"));
  });
});

describe(valueAt, () => {
  it("finds a nested value, or nothing where there is none", () => {
    const config = { input: { keyboard: { xkb_layout: "us" } } };
    expect(valueAt(config, ["input", "keyboard", "xkb_layout"])).toBe("us");
    expect(valueAt(config, ["idle", "blank_after_seconds"])).toBeUndefined();
  });
});

describe(withValue, () => {
  it("sets a value, making the sections on its way", () => {
    expect(withValue({ shell: "x" }, ["theme", "mode"], "light")).toEqual({
      shell: "x",
      theme: { mode: "light" },
    });
  });

  it("leaves the original and every other key alone", () => {
    const config = { theme: { contrast: "high", mode: "dark" } };
    expect(withValue(config, ["theme", "mode"], "light")).toEqual({
      theme: { contrast: "high", mode: "light" },
    });
    expect(config.theme.mode).toBe("dark");
  });

  it("removes a value set to nothing, and a section left empty", () => {
    expect(
      withValue(
        { idle: { blank_after_seconds: 300 } },
        ["idle", "blank_after_seconds"],
        undefined,
      ),
    ).toEqual({});
  });
});

describe("arrays", () => {
  const config = {
    output: { profiles: [{ name: "desk" }, { name: "laptop" }] },
  };

  it("are indexed by number", () => {
    expect(valueAt(config, ["output", "profiles", 1, "name"])).toBe("laptop");
    expect(
      withValue(config, ["output", "profiles", 1, "name"], "away"),
    ).toEqual({ output: { profiles: [{ name: "desk" }, { name: "away" }] } });
  });

  it("lose an item set to nothing", () => {
    expect(withValue(config, ["output", "profiles", 0], undefined)).toEqual({
      output: { profiles: [{ name: "laptop" }] },
    });
  });
});

describe(serialize, () => {
  it("writes two-space JSON ending in a newline", () => {
    expect(serialize({ theme: { mode: "light" } })).toBe(
      '{\n  "theme": {\n    "mode": "light"\n  }\n}\n',
    );
  });
});
