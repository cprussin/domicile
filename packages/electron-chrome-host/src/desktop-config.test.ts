import { describe, expect, it } from "bun:test";

import { parseDesktop } from "./desktop-config";

describe("parseDesktop", () => {
  it("reads the desktop out of a shell's own config", () => {
    expect(
      parseDesktop({
        displays: [{ name: "left", position: [0, 0], size: [1920, 1080] }],
        keyboard: { layout: "us", options: ["caps:swapescape"] },
        nestedSize: [1280, 800],
      }),
    ).toEqual({
      displays: [{ name: "left", position: [0, 0], size: [1920, 1080] }],
      keyboard: { layout: "us", options: ["caps:swapescape"] },
      nestedSize: [1280, 800],
    });
  });

  it("takes an absent desktop as nothing to say", () => {
    // A shell whose user configured only the shell's own half still has a
    // desktop; it is the compositor's defaults.
    expect(parseDesktop(undefined)).toEqual({});
  });

  it("refuses a display that is not one", () => {
    // The compositor would refuse it too, three processes later, in a message
    // about a file the user did not write. This is the file they did.
    expect(() => parseDesktop({ displays: [{ name: "left" }] })).toThrow();
  });

  it("refuses a size the compositor could not accept", () => {
    // A size is `(u32, u32)` on the other side, and zero is rejected there.
    // Sharing a signed, zero-permitting schema with `position` — which is
    // genuinely signed — sent both three processes downstream to be refused in
    // a message about a file the user never wrote.
    expect(() =>
      parseDesktop({ displays: [{ name: "a", size: [0, 1080] }] }),
    ).toThrow();
    expect(() =>
      parseDesktop({ displays: [{ name: "a", size: [1920, -1080] }] }),
    ).toThrow();
    expect(() => parseDesktop({ nestedSize: [-1, 800] })).toThrow();
  });

  it("keeps a position signed, because a display may sit left of the origin", () => {
    expect(
      parseDesktop({
        displays: [{ name: "a", position: [-1920, 0], size: [1920, 1080] }],
      }),
    ).toEqual({
      displays: [{ name: "a", position: [-1920, 0], size: [1920, 1080] }],
    });
  });

  it("refuses a key the compositor does not read", () => {
    // Almost always a misspelling of one it does, and a setting that silently
    // does nothing is worse than a refusal naming it.
    expect(() => parseDesktop({ nested_size: [800, 600] })).toThrow();
  });
});
