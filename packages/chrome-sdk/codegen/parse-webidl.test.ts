import { describe, expect, it } from "bun:test";

import { parseWebIdl } from "./parse-webidl";

const LICENSE =
  "// Copyright 2026 Someone\n// SPDX-License-Identifier: MIT\n\n";

describe("parseWebIdl", () => {
  it("reads an interface's attributes, operations and event handlers, and their comments", () => {
    const idl = parseWebIdl(`${LICENSE}
// The host.
//
// More about it.
//
[
    Exposed=Window
] interface Host : EventTarget {
  constructor(DOMString type, optional HostInit init = {});

  // Run it.
  [CallWith=ScriptState, RaisesException] undefined spawn(
      sequence<DOMString> command);

  // A note on its own.

  readonly attribute FrozenArray<Display>? displays;
  readonly attribute unsigned long id;
  attribute EventHandler onchanged;
};
`);

    expect(idl).toStrictEqual({
      dictionaries: [],
      enums: [],
      interfaces: [
        {
          attributes: [
            {
              doc: [],
              name: "displays",
              type: {
                arguments: [
                  { arguments: [], name: "Display", nullable: false },
                ],
                name: "FrozenArray",
                nullable: true,
              },
            },
            {
              doc: [],
              name: "id",
              type: { arguments: [], name: "unsigned long", nullable: false },
            },
          ],
          doc: ["The host.", "", "More about it."],
          events: [{ doc: [], name: "changed" }],
          inherits: "EventTarget",
          name: "Host",
          operations: [
            {
              arguments: [
                {
                  name: "command",
                  type: {
                    arguments: [
                      { arguments: [], name: "DOMString", nullable: false },
                    ],
                    name: "sequence",
                    nullable: false,
                  },
                },
              ],
              doc: ["Run it."],
              name: "spawn",
              returnType: { arguments: [], name: "undefined", nullable: false },
            },
          ],
        },
      ],
    });
  });

  it("reads a dictionary's required and defaulted members", () => {
    const idl = parseWebIdl(`${LICENSE}// A key.
dictionary Key : EventInit {
  // The code.
  required unsigned long keycode;
  boolean altKey = false;
  sequence<DOMString> names = [];
  double? scale;
};
`);

    expect(idl.dictionaries).toStrictEqual([
      {
        doc: ["A key."],
        inherits: "EventInit",
        members: [
          {
            defaulted: false,
            doc: ["The code."],
            name: "keycode",
            required: true,
            type: { arguments: [], name: "unsigned long", nullable: false },
          },
          {
            defaulted: true,
            doc: [],
            name: "altKey",
            required: false,
            type: { arguments: [], name: "boolean", nullable: false },
          },
          {
            defaulted: true,
            doc: [],
            name: "names",
            required: false,
            type: {
              arguments: [
                { arguments: [], name: "DOMString", nullable: false },
              ],
              name: "sequence",
              nullable: false,
            },
          },
          {
            defaulted: false,
            doc: [],
            name: "scale",
            required: false,
            type: { arguments: [], name: "double", nullable: true },
          },
        ],
        name: "Key",
      },
    ]);
  });

  it("reads an enum's values in order", () => {
    expect(
      parseWebIdl(`${LICENSE}enum Theme {
  "dark",
  "light",
};
`).enums,
    ).toStrictEqual([{ doc: [], name: "Theme", values: ["dark", "light"] }]);
  });

  it("throws on syntax it does not read, naming the line", () => {
    expect(() =>
      parseWebIdl(`${LICENSE}interface Host {
  readonly attribute (DOMString or long) value;
};
`),
    ).toThrow("line 5");
  });
});
