import { describe, expect, it } from "bun:test";

import { configDocument } from "./compositor-config";

describe("configDocument", () => {
  it("writes the shape the compositor reads", () => {
    // The names on the wire are the compositor's, which are not the ones a
    // shell author writes: mapping them here is what keeps every shell from
    // having to know both.
    expect(
      configDocument({
        displays: [
          { name: "left", position: [0, 0], size: [1920, 1080] },
          { name: "right", position: [1920, 0], scale: 2, size: [2560, 1440] },
        ],
        keyboard: { layout: "us", options: ["caps:swapescape"] },
        maxScale: 2,
        nestedSize: [1280, 800],
      }),
    ).toEqual({
      compositor: { nested_size: [1280, 800] },
      input: {
        keyboard: {
          xkb_layout: "us",
          xkb_model: "",
          xkb_options: ["caps:swapescape"],
          xkb_rules: "",
          xkb_variant: "",
        },
      },
      output: {
        displays: [
          { name: "left", position: [0, 0], size: [1920, 1080] },
          { name: "right", position: [1920, 0], scale: 2, size: [2560, 1440] },
        ],
        max_scale: 2,
      },
    });
  });

  it("states a whole keyboard once a shell states any of it", () => {
    // Each `xkb_*` field defaults on the compositor's side, and its defaults
    // are Programmer's Dvorak with Caps and Escape swapped. Dropping the keys
    // a shell left out means `{ layout: "us" }` — the most obvious thing to
    // write — silently produces a keymap nobody asked for, on every client on
    // the desktop.
    expect(configDocument({ keyboard: { layout: "us" } })).toEqual({
      compositor: {},
      input: {
        keyboard: {
          xkb_layout: "us",
          xkb_model: "",
          xkb_options: [],
          xkb_rules: "",
          xkb_variant: "",
        },
      },
      output: {},
    });
  });

  it("states a whole keyboard even for a shell that mentioned none", () => {
    // The case that is overwhelmingly the common one: both shipped shells on a
    // fresh install, the example, and the guide's own sample config all say
    // nothing about keyboards. An empty section is filled in by the
    // compositor's own defaults, which are one person's layout — so saying
    // nothing has to mean something neutral rather than something inherited.
    //
    // Asserted on the whole document: `deny_unknown_fields` on the other side
    // makes an emitted key a claim rather than a placeholder, so what stays
    // *out* of `compositor` and `output` matters as much as what goes in.
    expect(JSON.stringify(configDocument({}))).toBe(
      '{"compositor":{},"input":{"keyboard":{"xkb_model":"","xkb_options":[],"xkb_rules":"","xkb_variant":""}},"output":{}}',
    );
  });
});
