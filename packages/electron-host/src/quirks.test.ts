import { describe, expect, it } from "bun:test";

import { quirksOf } from "./quirks";

describe(quirksOf, () => {
  it("names why an app known to need Node in its pages can't run on the engine", () => {
    expect(quirksOf("signal-desktop").needsNodeInPages).toBe(
      "its pages load libsignal and ringrtc",
    );
  });

  it("knows each app inspected for phase 2 by its package name", () => {
    for (const name of [
      "signal-desktop",
      "teams-for-linux",
      "zulip",
      "@joplin/app-desktop",
    ]) {
      expect(quirksOf(name).needsNodeInPages).toBeString();
    }
  });

  it("has no quirks for an app it doesn't list", () => {
    expect(quirksOf("element-desktop")).toEqual({});
  });
});
