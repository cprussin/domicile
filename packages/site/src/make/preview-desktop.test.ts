import { describe, expect, it } from "bun:test";

import { previewDesktop } from "./preview-desktop";

describe("previewDesktop", () => {
  it("has the stand-in windows, the first one focused", () => {
    const { domicile } = previewDesktop();

    expect(domicile.windows.list.map((window) => window.title)).toEqual([
      "Terminal",
      "Editor",
      "Music",
      "Files",
    ]);
    expect(domicile.windows.focused).toBe("terminal");
  });

  it("moves the focus where the shell asks, as the engine does", async () => {
    const { domicile } = previewDesktop();

    await new Promise<void>((resolve) => {
      domicile.windows.on("focuschange", resolve);
      domicile.windows.focus("music");
    });

    expect(domicile.windows.focused).toBe("music");
  });
});
