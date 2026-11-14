import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { writeAsar } from "../asar-fixture";
import type { FakeEngine } from "../engine-fixture";
import { startFakeEngine } from "../engine-fixture";

const MAIN = join(import.meta.dir, "../main.ts");

const MAIN_JS = `
const { app } = require("electron");
app.whenReady().then(() => {
  console.log(JSON.stringify({
    appPath: app.getAppPath(),
    argv: process.argv.slice(1),
    electron: process.versions.electron,
    name: app.getName(),
    resourcesPath: process.resourcesPath,
    type: process.type,
    userData: app.getPath("userData"),
  }));
  app.quit();
});
`;

const WINDOW_JS = `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(async () => {
  const window = new BrowserWindow();
  await window.loadFile("index.html");
  console.log(JSON.stringify({ title: window.getTitle() }));
  app.quit();
});
`;

const run = async (
  resources: string,
  home: string,
  args: string[],
  engine: FakeEngine | undefined,
) => {
  const { DOMICILE_ELECTRON_SOCK: _theirs, ...inherited } = env;
  const child = Bun.spawn(["bun", MAIN, resources, ...args], {
    env: {
      ...inherited,
      ...(engine === undefined ? {} : { DOMICILE_ELECTRON_SOCK: engine.path }),
      HOME: home,
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    code: await child.exited,
    stderr: await new Response(child.stderr).text(),
    stdout: await new Response(child.stdout).text(),
  };
};

let engine: FakeEngine | undefined;

afterEach(async () => {
  await engine?.close();
  engine = undefined;
});

describe("electron-host", () => {
  it("runs the app's main with the stand-in, from its mirror", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-main-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "main.js": { content: MAIN_JS },
      "package.json": {
        content: `{"main":"main.js","name":"notes","productName":"Notes","version":"1.2.3"}`,
      },
    });

    engine = await startFakeEngine();
    const { code, stdout } = await run(
      resources,
      home,
      ["--open", "x.txt"],
      engine,
    );
    const seen = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(seen).toMatchObject({
      argv: ["--open", "x.txt"],
      electron: "45.2.1",
      name: "Notes",
      type: "browser",
      userData: join(home, ".config/Notes"),
    });
    expect(seen.appPath).toStartWith(join(home, ".cache/domicile/electron/"));
    expect(seen.appPath).toBe(join(seen.resourcesPath, "app.asar"));
  });

  it("says why when the app can't be read", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-main-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "package.json": { content: `{"name":"notes","version":"1.2.3"}` },
    });
    await writeFile(join(resources, "extra.asar"), "junk");

    const { code, stderr } = await run(resources, home, [], undefined);

    expect(code).toBe(1);
    expect(stderr).toContain(
      `${join(resources, "extra.asar")} is not an asar archive`,
    );
  });

  it("opens the app's windows on the engine as its own app", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-main-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "index.html": { content: "<title>Notes</title>" },
      "main.js": { content: WINDOW_JS },
      "package.json": {
        content: `{"main":"main.js","name":"notes","desktopName":"com.example.Notes.desktop","version":"1.2.3"}`,
      },
    });
    engine = await startFakeEngine((request) =>
      request.type === "hello"
        ? [{ type: "ready" }]
        : [
            { type: "window_opened", window: 1 },
            { title: "Notes", type: "title_changed", window: 1 },
            { type: "window_loaded", window: 1 },
          ],
    );

    const { code, stderr, stdout } = await run(resources, home, [], engine);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({ title: "Notes" });
    expect(engine.heard[0]).toEqual({
      app_id: "com.example.Notes",
      partition: "persist:electron-notes",
      type: "hello",
      version: 1,
    });
    expect(engine.heard[1]).toMatchObject({ type: "open_window", window: 1 });
    expect((engine.heard[1] as { url: string }).url).toEndWith(
      "/app.asar/index.html",
    );
  });

  it("says why when there is no desktop to open windows on", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-main-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "main.js": { content: MAIN_JS },
      "package.json": {
        content: `{"main":"main.js","name":"notes","version":"1.2.3"}`,
      },
    });

    const { code, stderr } = await run(resources, home, [], undefined);

    expect(code).toBe(1);
    expect(stderr).toContain("DOMICILE_ELECTRON_SOCK is not set");
  });
});
