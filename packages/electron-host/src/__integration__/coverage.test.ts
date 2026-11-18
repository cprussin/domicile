// Every Electron API an app can reach that the host doesn't do yet, measured
// on the running host and held against `coverage.json`. A gap that opens,
// say from a new Electron version, or one that closes, fails until the list
// is updated: `UPDATE_COVERAGE=1 bun test coverage`. See "Every API" in
// docs/architecture/ELECTRON-APPS.md.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { writeAsar } from "../asar-fixture";
import { startFakeDesktopBus } from "../desktop-bus-fixture";
import { ELECTRON_INSTANCES, ELECTRON_SURFACE } from "../electron/surface";
import type { FakeEngine } from "../engine-fixture";
import { startFakeEngine } from "../engine-fixture";

const MAIN = join(import.meta.dir, "../main.ts");
const COVERAGE = join(import.meta.dir, "coverage.json");

/**
 * An app that walks the surface and prints, per module and per object it
 * can make, what hands it back to its own Electron ("missing") and what
 * isn't there at all ("absent", which would crash it).
 */
const AUDIT_JS = `
if (process.parentPort !== undefined) {
  // The utility process it forks below, which has nothing to do.
  process.exit(0);
}
const electron = require("electron");
const surface = ${JSON.stringify(ELECTRON_SURFACE)};
const instances = ${JSON.stringify(ELECTRON_INSTANCES)};
const gaps = [];
const walk = (owner, value, names) => {
  for (const name of names) {
    const member = value[name];
    if (typeof member === "function" && member.name === "missingElectronApi") {
      gaps.push(owner + "." + name + " missing");
    } else if (member === undefined) {
      gaps.push(owner + "." + name + " absent");
    }
  }
};
for (const [name, { kind, methods, properties }] of Object.entries(surface)) {
  const module = electron[name];
  if (kind === "class" && module.name === "MissingElectronClass") {
    gaps.push(name + " missing");
  } else {
    walk(name, module, methods);
    walk(name, module, properties);
  }
}
electron.app.whenReady().then(() => {
  const window = new electron.BrowserWindow({ show: false });
  const session = electron.session.defaultSession;
  const made = {
    BaseWindow: window,
    BrowserView: new electron.BrowserView(),
    BrowserWindow: window,
    Cookies: session.cookies,
    Menu: new electron.Menu(),
    MenuItem: new electron.MenuItem({ label: "x" }),
    MessagePortMain: new electron.MessageChannelMain().port1,
    NativeImage: electron.nativeImage.createEmpty(),
    NavigationHistory: window.webContents.navigationHistory,
    Notification: new electron.Notification({ title: "x" }),
    ServiceWorkers: session.serviceWorkers,
    Tray: new electron.Tray(electron.nativeImage.createEmpty()),
    UtilityProcess: electron.utilityProcess.fork(__filename),
    Session: session,
    WebContents: window.webContents,
    WebContentsView: new electron.WebContentsView(),
    WebFrameMain: window.webContents.mainFrame,
    WebRequest: session.webRequest,
  };
  for (const [type, { methods, properties }] of Object.entries(instances)) {
    const value = made[type];
    if (value === undefined) {
      gaps.push(type + " unmeasured");
    } else {
      walk(type, value, methods);
      walk(type, value, properties);
    }
  }
  console.log(JSON.stringify(gaps));
  electron.app.exit(0);
});
`;

let engine: FakeEngine | undefined;
let bus: Awaited<ReturnType<typeof startFakeDesktopBus>> | undefined;

afterEach(async () => {
  await engine?.close();
  await bus?.close();
});

describe("Electron coverage", () => {
  it("is what coverage.json lists", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-coverage-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "main.js": { content: AUDIT_JS },
      "package.json": {
        content: `{"main":"main.js","name":"audit","productName":"Audit","version":"1.0.0"}`,
      },
    });
    engine = await startFakeEngine();
    bus = await startFakeDesktopBus({ colorScheme: 1, contrast: 0 });
    const {
      DBUS_SESSION_BUS_ADDRESS: _theirBus,
      DOMICILE_ELECTRON_SOCK: _theirs,
      ...inherited
    } = env;
    const child = Bun.spawn(["bun", MAIN, resources], {
      env: {
        ...inherited,
        DBUS_SESSION_BUS_ADDRESS: bus.address,
        DOMICILE_ELECTRON_SOCK: engine.path,
        HOME: home,
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_CONFIG_HOME: join(home, ".config"),
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    expect({ code: await child.exited, stderr }).toMatchObject({ code: 0 });
    const gaps = (JSON.parse(stdout) as string[]).sort();

    // biome-ignore lint/style/noProcessEnv: how a developer updates the list
    if (env.UPDATE_COVERAGE === "1") {
      await writeFile(COVERAGE, `${JSON.stringify(gaps, null, 2)}\n`);
    }
    expect(gaps).toEqual(JSON.parse(await readFile(COVERAGE, "utf8")));
  }, 30_000);
});
