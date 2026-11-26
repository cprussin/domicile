import { describe, expect, it } from "bun:test";

import { writtenOver } from "./written-over";

describe(writtenOver, () => {
  it("keeps a change under a section written whole out of the file", () => {
    const { ended, text } = writtenOver(
      {
        browser: {
          default_profile: "personal",
          profiles: { work: { extensions: ["a"], name: "Work" } },
        },
      },
      [
        {
          path: ["browser", "profiles", "work", "extensions"],
          value: [],
          written: ["a"],
        },
      ],
      ["browser"],
      {
        default_profile: "work",
        profiles: { work: { extensions: [], name: "Work" } },
      },
    );
    expect(JSON.parse(text)).toEqual({
      browser: {
        default_profile: "work",
        profiles: { work: { extensions: ["a"], name: "Work" } },
      },
    });
    expect(ended).toEqual([]);
  });

  it("writes a change under the section the user made there, ending it", () => {
    const { ended, text } = writtenOver(
      { browser: { default_profile: "personal" } },
      [
        {
          path: ["browser", "default_profile"],
          value: "private",
          written: "personal",
        },
      ],
      ["browser"],
      { default_profile: "work" },
    );
    expect(JSON.parse(text)).toEqual({ browser: { default_profile: "work" } });
    expect(ended).toEqual([["browser", "default_profile"]]);
  });

  it("ends a change in a list item the write moved, writing it nowhere", () => {
    const { ended, text } = writtenOver(
      {
        output: {
          profiles: [
            { displays: [{ display: "x" }], name: "a" },
            { displays: [{ display: "y" }], name: "b" },
          ],
        },
      },
      [
        {
          path: ["output", "profiles", 0, "displays", 0, "enabled"],
          value: false,
          written: null,
        },
      ],
      ["output", "profiles"],
      [{ displays: [{ display: "y" }], name: "b" }],
    );
    expect(JSON.parse(text)).toEqual({
      output: { profiles: [{ displays: [{ display: "y" }], name: "b" }] },
    });
    expect(ended).toEqual([
      ["output", "profiles", 0, "displays", 0, "enabled"],
    ]);
  });

  it("ends a change at the path only when the file keeps its value", () => {
    const change = { path: ["theme", "mode"], value: "dark", written: "light" };
    expect(
      writtenOver(
        { theme: { mode: "light" } },
        [change],
        ["theme", "mode"],
        "light",
      ).ended,
    ).toEqual([["theme", "mode"]]);
    expect(
      writtenOver(
        { theme: { mode: "light" } },
        [change],
        ["theme", "mode"],
        "dark",
      ).ended,
    ).toEqual([]);
  });
});
