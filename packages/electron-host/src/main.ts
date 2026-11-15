#!/usr/bin/env bun
// Runs an installed Electron app's main process on Domicile:
// `electron-host <install>/resources [app arguments…]`.

import { statSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readAppPackage } from "./app-package";
import { watchAppearance } from "./appearance";
import { connectDesktop, runCommand, runCommandSync } from "./desktop";
import { createApp } from "./electron/app";
import { createBrowserWindow } from "./electron/browser-window";
import { createClipboard } from "./electron/clipboard";
import { createDialog } from "./electron/dialog";
import { createIpcMain } from "./electron/ipc-main";
import { createMenu } from "./electron/menu";
import { createMessageBoxes } from "./electron/message-boxes";
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

/** A window as the app's menus hand it to a click: one of its BrowserWindows. */
type MenuWindow = { readonly close: () => void };

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
    const webRequests = createWebRequests(engine.send, (window) =>
      webContentsOf(window),
    );
    engine.events.on("webRequest", webRequests.hear);
    const sessionCalls = createSessionCalls(engine.send);
    engine.events.on("sessionResult", sessionCalls.hear);
    const permissions = createPermissions(
      engine.send,
      (window) => webContentsOf(window),
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
    // Read before the app's main runs, as an app reads its theme as it starts.
    const desktop = await reachDesktop(env);
    const theme: { changed?: (next: Appearance) => void } = {};
    const { appearanceChanged, nativeTheme } = createNativeTheme(
      await watchAppearance(desktop.settings, (next) => {
        theme.changed?.(next);
      }),
    );
    theme.changed = appearanceChanged;
    const { click, Menu, MenuItem, model } = createMenu<MenuWindow>({
      appName: app.getName,
      focusedWindow: (): MenuWindow | null => BrowserWindow.getFocusedWindow(),
      roles: {
        close: (window) => window?.close(),
        quit: () => app.quit(),
      },
      // Electron gives every window the app's menu, as each new one starts with.
      setApplicationMenu: (menu) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.setMenu(menu);
        }
      },
    });
    const { BrowserView, BrowserWindow, WebContentsView, webContentsOf } =
      createBrowserWindow(
        engine,
        app,
        ipc,
        session,
        {
          applicationMenu: Menu.getApplicationMenu,
          click: (menu, command, window) => {
            click(menu, command, undefined, BrowserWindow.fromId(window));
          },
          model,
        },
        undefined,
        unsupported,
      );
    const messageBoxes = createMessageBoxes(engine.send);
    engine.events.on("window", (event) => {
      if (event.type === "message_box_answered") {
        messageBoxes.hear(event);
      }
    });
    const electron = {
      app,
      BrowserView,
      BrowserWindow,
      clipboard: createClipboard({ run: runCommandSync }),
      dialog: createDialog({
        askMessageBox: async (window, options) =>
          messageBoxes.ask(boxWindow(window, BrowserWindow), options),
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
      WebContentsView,
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

/**
 * The window a message box goes over: the one the app named, else its most
 * recent open one. Throws with none, as there is nowhere to show it.
 */
const boxWindow = (
  named: unknown,
  windows: {
    getAllWindows: () => { id: number; isDestroyed: () => boolean }[];
  },
): number => {
  if (named !== undefined && named !== null) {
    const { id } = named as { id: unknown };
    if (typeof id !== "number") {
      throw new TypeError(
        "dialog.showMessageBox takes a BrowserWindow, then its options",
      );
    }
    return id;
  }
  const open = windows
    .getAllWindows()
    .filter((window) => !window.isDestroyed());
  const recent = open.at(-1);
  if (recent === undefined) {
    throw new Error(
      "dialog.showMessageBox needs a window to show over on Domicile, and the app has none open",
    );
  }
  return recent.id;
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

/**
 * The status the host exits with when the app needs what the engine doesn't
 * do yet: `domicile open --electron` then runs the app on its own Electron.
 * Matches `UNSUPPORTED_EXIT` in `packages/domicile-launch`.
 */
const UNSUPPORTED_EXIT = 3;

/** Gives up on an app the engine can't run yet, whatever the app catches. */
const unsupported = (why: string): never => {
  // biome-ignore lint/suspicious/noConsole: why the app runs on its own Electron, for the desktop's log
  console.error(`electron-host: ${why}`);
  process.exit(UNSUPPORTED_EXIT);
};

const fail = (why: string): never => {
  // biome-ignore lint/suspicious/noConsole: the reason the app can't start, for the supervisor's log
  console.error(`electron-host: ${why}`);
  process.exit(1);
};

await main(process.argv.slice(2));
