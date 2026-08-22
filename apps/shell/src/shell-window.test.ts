import { describe, expect, it } from "bun:test";

import { appIdOf, ShellWindow, WindowKind } from "./shell-window";

describe("ShellWindow", () => {
  describe("App", () => {
    it("namespaces the app id so a client cannot collide with a browser", () => {
      expect(ShellWindow.App("term", "Terminal")).toStrictEqual({
        appId: "term",
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
