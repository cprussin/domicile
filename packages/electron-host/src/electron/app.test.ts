import { describe, expect, it } from "bun:test";

import { electronPaths } from "../paths";
import { createApp } from "./app";

const paths = electronPaths({
  env: {},
  execPath: "/bin/bun",
  home: "/home/me",
  productName: "Claude",
  temp: "/tmp",
  userDirs: undefined,
});

const make = (exit: (code: number) => void = () => undefined) =>
  createApp({
    appPath: "/cache/x/resources/app.asar",
    exit,
    paths,
    pkg: {
      main: "/cache/x/resources/app.asar/main.js",
      name: "@ant/desktop",
      productName: "Claude",
      version: "5.1.0",
    },
  });

describe(createApp, () => {
  describe("identity", () => {
    it("answers the app's name, version and path from its package", () => {
      const { app } = make();

      expect(app.name).toBe("Claude");
      expect(app.getName()).toBe("Claude");
      expect(app.getVersion()).toBe("5.1.0");
      expect(app.getAppPath()).toBe("/cache/x/resources/app.asar");
      expect(app.isPackaged).toBe(true);
    });

    it("takes a new name", () => {
      const { app } = make();
      app.setName("Claude Dev");

      expect(app.name).toBe("Claude Dev");
      app.name = "Other";
      expect(app.getName()).toBe("Other");
    });
  });

  describe("paths", () => {
    it("answers and overrides paths, and throws on a name Electron doesn't know", () => {
      const { app } = make();

      expect(app.getPath("userData")).toBe("/home/me/.config/Claude");
      app.setPath("userData", "/elsewhere");
      expect(app.getPath("userData")).toBe("/elsewhere");
      expect(() => app.getPath("nowhere")).toThrow(
        "Failed to get 'nowhere' path",
      );
    });
  });

  describe("lifecycle", () => {
    it("is ready once the host says so, and says so", async () => {
      const { app, markReady } = make();
      const heard = new Promise((resolve) => app.once("ready", resolve));

      expect(app.isReady()).toBe(false);
      markReady();
      await app.whenReady();
      await heard;
      expect(app.isReady()).toBe(true);
    });

    it("quits after before-quit, will-quit and quit", async () => {
      const heard: string[] = [];
      const exited = new Promise<number>((resolve) => {
        const { app } = make(resolve);
        for (const name of ["before-quit", "will-quit", "quit"]) {
          app.on(name, () => heard.push(name));
        }
        app.quit();
      });

      expect(await exited).toBe(0);
      expect(heard).toEqual(["before-quit", "will-quit", "quit"]);
    });

    it("stays up when before-quit is prevented", () => {
      const exits: number[] = [];
      const { app } = make((code) => exits.push(code));
      app.on("before-quit", (event: { preventDefault: () => void }) =>
        event.preventDefault(),
      );
      app.quit();

      expect(exits).toEqual([]);
    });

    it("exits at once with the code given", () => {
      const exits: number[] = [];
      const { app } = make((code) => exits.push(code));
      app.exit(3);

      expect(exits).toEqual([3]);
    });
  });

  describe("command line", () => {
    it("keeps the switches the app appends", () => {
      const { app } = make();
      app.commandLine.appendSwitch("enable-features", "Foo");
      app.commandLine.appendSwitch("no-sandbox");

      expect(app.commandLine.hasSwitch("no-sandbox")).toBe(true);
      expect(app.commandLine.getSwitchValue("enable-features")).toBe("Foo");
      expect(app.commandLine.getSwitchValue("missing")).toBe("");
      app.commandLine.removeSwitch("no-sandbox");
      expect(app.commandLine.hasSwitch("no-sandbox")).toBe(false);
    });
  });
});
