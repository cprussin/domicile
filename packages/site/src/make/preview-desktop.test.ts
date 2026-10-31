import { describe, expect, it } from "bun:test";

import { previewDesktop } from "./preview-desktop";
import { launchedStandIn } from "./stand-ins";

describe("previewDesktop", () => {
  it("has the stand-in windows, the first one focused", () => {
    const { domicile } = previewDesktop();

    expect(domicile.windows.list.map((window) => window.title)).toEqual([
      "Browser",
      "Chat",
      "Music",
      "Files",
    ]);
    expect(domicile.windows.focused).toBe("browser");
  });

  it("moves the focus where the shell asks, as the engine does", async () => {
    const { domicile } = previewDesktop();

    await new Promise<void>((resolve) => {
      domicile.windows.on("focuschange", resolve);
      domicile.windows.focus("music");
    });

    expect(domicile.windows.focused).toBe("music");
  });

  it("opens a window for each command the shell launches", async () => {
    const { domicile, standIns } = previewDesktop();

    await new Promise<void>((resolve) => {
      domicile.windows.on("change", resolve);
      domicile.processes.launch(["firefox", "--new-window"]);
    });

    expect(domicile.windows.list.at(-1)?.title).toBe("firefox");
    expect(standIns().at(-1)).toEqual(
      launchedStandIn("launched-1", ["firefox", "--new-window"]),
    );
  });
});
