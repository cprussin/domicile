import { describe, expect, it } from "bun:test";

import { appIdOf, ShellWindow, siteOf, WindowKind } from "./window";

describe("ShellWindow", () => {
  describe("App", () => {
    it("namespaces the app id so a client cannot collide with a browser", () => {
      expect(ShellWindow.App("term", "Terminal")).toStrictEqual({
        appId: "term",
        // A window opens knowing nothing the client has not said yet: it asks
        // for a cursor once it has something to ask about.
        cursor: undefined,
        id: "app:term",
        kind: WindowKind.App,
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

  // WHAT A PAGE CAN NAVIGATE ITSELF TO, which is not what the shell can send
  // it to. Every address this saw used to be the shell's own — `HOME_PAGE`, or
  // something `typedAddress` built, both of which have a host. It now sees
  // whatever the browser reports, and a page that goes to `about:blank` or a
  // `data:` URL has no host at all: a window named from the hostname would
  // lose its name and the user would be left with an unlabelled tab.
  it("falls back to the whole address when there is no host to name", () => {
    expect(siteOf("about:blank")).toBe("about:blank");
    expect(siteOf("data:text/html,hi")).toBe("data:text/html,hi");
  });
});
