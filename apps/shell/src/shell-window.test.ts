import { describe, expect, it } from "bun:test";

import { ShellWindow, WindowKind } from "./shell-window";

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
