import { describe, expect, it } from "bun:test";

import { FakeDomicileHost } from "./fake-host";

describe("FakeDomicileHost", () => {
  it("lists a window that appeared, changed and closed, saying so each time", () => {
    const fake = new FakeDomicileHost();
    let changed = 0;
    fake.host.addEventListener("windowschanged", () => {
      changed += 1;
    });

    fake.appear("term", { title: "Terminal" });
    fake.change("term", { height: 480, width: 640 });
    fake.appear("menu", { parent: "term" });
    fake.close("menu");

    expect(fake.host.windows).toMatchObject([
      { appId: "term", height: 480, title: "Terminal", width: 640 },
    ]);
    expect(changed).toBe(4);
  });

  it("sets state and dispatches its change event", () => {
    const fake = new FakeDomicileHost();
    const heard: string[] = [];
    fake.host.addEventListener("batterychanged", () => {
      heard.push("battery");
    });
    fake.host.addEventListener("focusedwindowchanged", () => {
      heard.push("focus");
    });

    fake.set({ batteryCharge: 0.5, batteryCharging: true });
    fake.set({ focusedWindow: "term" });

    expect(fake.host.batteryCharge).toBe(0.5);
    expect(fake.host.focusedWindow).toBe("term");
    expect(heard).toStrictEqual(["battery", "focus"]);
  });

  it("records every call a shell makes", () => {
    const fake = new FakeDomicileHost();

    fake.host.spawn(["kitty"]);
    fake.host.focusApp("term");

    expect(fake.calls).toStrictEqual([
      ["spawn", ["kitty"]],
      ["focusApp", "term"],
    ]);
  });

  it("opens and closes browser windows as the engine does", () => {
    const fake = new FakeDomicileHost();
    let changed = 0;
    fake.host.addEventListener("browserwindowschanged", () => {
      changed += 1;
    });

    fake.host.openBrowserWindow("https://example.com");
    fake.openBrowser("chrome-extension://vault/popup.html", 7);
    fake.host.closeBrowserWindow("1");

    expect(fake.host.browserWindows).toMatchObject([
      { id: "2", popupWindow: 7, url: "chrome-extension://vault/popup.html" },
    ]);
    expect(fake.calls).toStrictEqual([
      ["openBrowserWindow", "https://example.com"],
      ["closeBrowserWindow", "1"],
    ]);
    expect(changed).toBe(3);
  });

  it("dispatches a moment with its fields", () => {
    const fake = new FakeDomicileHost();
    const chords: string[] = [];
    fake.host.addEventListener("shortcut", (event) => {
      chords.push(event.chord);
    });

    fake.dispatch("shortcut", { chord: "Meta+Return" });

    expect(chords).toStrictEqual(["Meta+Return"]);
  });
});
