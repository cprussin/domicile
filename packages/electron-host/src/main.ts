#!/usr/bin/env bun
// Runs an installed Electron app's main process on Domicile:
// `electron-host <install>/resources [app arguments…]`.

import { access, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { readAppPackage } from "./app-package";
import { createApp } from "./electron/app";
import { createBrowserWindow } from "./electron/browser-window";
import { ELECTRON_VERSION } from "./electron/version";
import { connectEngine } from "./engine";
import { readEnvironment } from "./environment";
import { mirrorResources } from "./mirror";
import { electronPaths } from "./paths";

const main = async ([resources, ...args]: string[]) => {
  if (resources === undefined) {
    throw new Error("usage: electron-host <resources directory> [arguments…]");
  } else {
    const home = homedir();
    const env = readEnvironment();
    const cache = join(
      env.XDG_CACHE_HOME ?? join(home, ".cache"),
      "domicile/electron",
    );
    const mirror = (await mirrorResources(resources, cache)).match({
      Err: fail,
      Ok: (path) => path,
    });
    const appPath = await appDirectory(mirror);
    const pkg = (await readAppPackage(appPath)).match({
      Err: fail,
      Ok: (value) => value,
    });
    const configHome = env.XDG_CONFIG_HOME ?? join(home, ".config");
    const { app, markReady } = createApp({
      appPath,
      paths: electronPaths({
        env,
        execPath: process.execPath,
        home,
        productName: pkg.productName,
        temp: tmpdir(),
        userDirs: await readOptional(join(configHome, "user-dirs.dirs")),
      }),
      pkg,
    });
    const socket =
      env.DOMICILE_ELECTRON_SOCK ??
      fail(
        "DOMICILE_ELECTRON_SOCK is not set, so there is no desktop to open this app's windows on. Start it from inside a Domicile desktop.",
      );
    const engine = (
      await connectEngine(socket, pkg.appId, `persist:electron-${pkg.name}`)
    ).match({ Err: fail, Ok: (value) => value });
    engine.events.on("lost", (why) => fail(`lost the engine: ${why}`));
    engine.events.on("refused", (why) =>
      fail(`the engine refused a request: ${why}`),
    );
    const electron = { app, BrowserWindow: createBrowserWindow(engine, app) };
    Bun.plugin({
      name: "electron",
      setup: (build) => {
        for (const name of ["electron", "electron/main"]) {
          build.module(name, () => ({ exports: electron, loader: "object" }));
        }
      },
    });
    Object.assign(process, { resourcesPath: mirror, type: "browser" });
    Object.assign(process.versions, { electron: ELECTRON_VERSION });
    process.argv = [process.execPath, ...args];
    await import(pkg.main);
    markReady();
  }
};

/** Electron's order: an unpacked `app` directory, then `app.asar`. */
const appDirectory = async (mirror: string) => {
  const unpacked = join(mirror, "app");
  return (await readOptional(join(unpacked, "package.json"))) === undefined
    ? join(mirror, "app.asar")
    : unpacked;
};

const readOptional = async (path: string) => {
  try {
    await access(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    } else {
      throw error;
    }
  }
  return readFile(path, "utf8");
};

const fail = (why: string): never => {
  // biome-ignore lint/suspicious/noConsole: the reason the app can't start, for the supervisor's log
  console.error(`electron-host: ${why}`);
  process.exit(1);
};

await main(process.argv.slice(2));
