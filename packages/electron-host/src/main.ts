#!/usr/bin/env bun
// Runs an installed Electron app's main process on Domicile:
// `electron-host <install>/resources [app arguments…]`.

import { statSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readAppPackage } from "./app-package";
import { watchAppearance } from "./appearance";
import { connectDesktop, runCommand } from "./desktop";
import { createApp } from "./electron/app";
import { createBrowserWindow } from "./electron/browser-window";
import { createDialog } from "./electron/dialog";
import { createIpcMain } from "./electron/ipc-main";
import { createMenu } from "./electron/menu";
import {
  MessageChannelMain,
  MessagePortMain,
} from "./electron/message-port-main";
import { nativeImage } from "./electron/native-image";
import type { Appearance } from "./electron/native-theme";
import { createNativeTheme } from "./electron/native-theme";
import { createNotification } from "./electron/notification";
import { createPermissions } from "./electron/permissions";
import {
  createProtocols,
  registerSchemesAsPrivileged,
} from "./electron/protocol";
import { createSafeStorage } from "./electron/safe-storage";
import { createSessions } from "./electron/session";
import { createSessionCalls } from "./electron/session-calls";
import { createShell } from "./electron/shell";
import { createTray } from "./electron/tray";
import { utilityProcess } from "./electron/utility-process";
import { ELECTRON_VERSION } from "./electron/version";
import { createWebRequests } from "./electron/web-request";
import { connectEngine } from "./engine";
import type { Environment } from "./environment";
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
    const { ipcMain, ...ipc } = createIpcMain();
    const protocols = createProtocols(engine.send);
    engine.events.on("protocol", (request) => {
      void protocols.answer(request);
    });
    const webRequests = createWebRequests(
      engine.send,
      (window) => BrowserWindow.fromId(window)?.webContents,
    );
    engine.events.on("webRequest", webRequests.hear);
    const sessionCalls = createSessionCalls(engine.send);
    engine.events.on("sessionResult", sessionCalls.hear);
    const permissions = createPermissions(
      engine.send,
      (window) => BrowserWindow.fromId(window)?.webContents,
      (warning) => {
        // biome-ignore lint/suspicious/noConsole: what the engine does not do for this app, for the app's developer
        console.warn(`electron-host: ${warning}`);
      },
    );
    engine.events.on("permissionRequest", permissions.hear);
    const session = createSessions(
      protocols,
      webRequests,
      sessionCalls,
      permissions,
    );
    const BrowserWindow = createBrowserWindow(engine, app, ipc, session);
    // Read before the app's main runs, as an app reads its theme as it starts.
    const desktop = await reachDesktop(env);
    const theme: { changed?: (next: Appearance) => void } = {};
    const { appearanceChanged, nativeTheme } = createNativeTheme(
      await watchAppearance(desktop.settings, (next) => {
        theme.changed?.(next);
      }),
    );
    theme.changed = appearanceChanged;
    const { click, Menu, MenuItem, model } = createMenu<
      InstanceType<typeof BrowserWindow>
    >({
      appName: app.getName,
      focusedWindow: BrowserWindow.getFocusedWindow,
      roles: {
        close: (window) => window?.close(),
        quit: () => app.quit(),
      },
      // The menu bar under the window's tab comes next; until then the app's
      // menu is kept for getApplicationMenu alone.
      setApplicationMenu: () => undefined,
    });
    const electron = {
      app,
      BrowserWindow,
      dialog: createDialog({
        choose: desktop.choose,
        chooseSync: desktop.chooseSync,
        isDirectory: (path) =>
          statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false,
        printError: (text) => {
          // biome-ignore lint/suspicious/noConsole: Electron's error box on a desktop with no dialog for it, for the supervisor's log
          console.error(text);
        },
      }),
      ipcMain,
      Menu,
      MenuItem,
      MessageChannelMain,
      MessagePortMain,
      Notification: createNotification(desktop.notifications, {
        appId: pkg.appId,
        name: app.getName(),
      }),
      nativeImage,
      nativeTheme,
      protocol: {
        ...session.defaultSession.protocol,
        registerSchemesAsPrivileged,
      },
      safeStorage: createSafeStorage({
        password: () => desktop.safeStoragePassword(app.getName()),
      }),
      session,
      shell: createShell(runCommand),
      Tray: createTray({
        connect: desktop.connect,
        menus: { click, model },
        name: app.getName,
      }),
      utilityProcess,
    };
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

/** The desktop's services on its session bus, or the host fails, naming why. */
const reachDesktop = async (env: Environment) => {
  const address =
    env.DBUS_SESSION_BUS_ADDRESS ??
    fail(
      "DBUS_SESSION_BUS_ADDRESS is not set, so there is no desktop session bus to read the theme from. Start the app from inside a Domicile desktop.",
    );
  try {
    return await connectDesktop(address);
  } catch (error) {
    return fail(
      `couldn't reach the desktop's settings portal and notification server: ${error instanceof Error ? error.message : String(error)}`,
    );
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
