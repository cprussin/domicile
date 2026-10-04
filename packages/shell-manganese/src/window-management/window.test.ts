import { describe, expect, it } from "bun:test";

import { appIdOf, ShellWindow, siteOf, WindowKind } from "./window";

describe("ShellWindow", () => {
  describe("App", () => {
    it("namespaces the app id so a client cannot collide with a browser", () => {
      expect(ShellWindow.App("term", "Terminal")).toStrictEqual({
        appId: "term",
        // Unset until the client reports them.
        cursor: undefined,
        id: "app:term",
        kind: WindowKind.App,
        maxSize: [undefined, undefined],
        minSize: [undefined, undefined],
        title: "Terminal",
      });
    });
  });

  describe("appIdOf", () => {
    it("reads the client back out of a window id", () => {
      expect(appIdOf(ShellWindow.App("term", "Terminal").id)).toBe("term");
    });

    it("has no client for a window the shell opened itself", () => {
      expect(appIdOf(ShellWindow.Browser(1, "https://example.com").id)).toBe(
        undefined,
      );
    });
  });

  describe("Browser", () => {
    it("titles the window with the site it is pointed at", () => {
      expect(ShellWindow.Browser(2, "https://www.google.com/search")).toEqual({
        id: "browser:2",
        kind: WindowKind.Browser,
        popupWindow: undefined,
        src: "https://www.google.com/search",
        title: "www.google.com",
      });
    });
  });
});

describe("siteOf", () => {
  it("names a window after the site it is showing", () => {
    expect(siteOf("https://docs.example.com/guide")).toBe("docs.example.com");
  });

  // A page can navigate to `about:blank` or a `data:` URL, which have no host.
  it("falls back to the whole address when there is no host to name", () => {
    expect(siteOf("about:blank")).toBe("about:blank");
    expect(siteOf("data:text/html,hi")).toBe("data:text/html,hi");
  });
});
