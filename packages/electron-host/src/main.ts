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
import { createAutoUpdater } from "./electron/auto-updater";
import { createBrowserWindow } from "./electron/browser-window";
import { createClipboard } from "./electron/clipboard";
import { completeElectron, completeInstances } from "./electron/complete";
import { createCrashReporter } from "./electron/crash-reporter";
import { desktopCapturer } from "./electron/desktop-capturer";
import { createDialog } from "./electron/dialog";
import { createGlobalShortcut } from "./electron/global-shortcut";
import { createIpcMain } from "./electron/ipc-main";
import { createMenu } from "./electron/menu";
import { boxWindow, createMessageBoxes } from "./electron/message-boxes";
import {
  MessageChannelMain,
  MessagePortMain,
} from "./electron/message-port-main";
import { nativeImage } from "./electron/native-image";
import type { Appearance } from "./electron/native-theme";
import { createNativeTheme } from "./electron/native-theme";
import { net } from "./electron/net";
import { createNotification } from "./electron/notification";
import { createPermissions } from "./electron/permissions";
import type { DesktopStatus } from "./electron/power";
import { createPowerMonitor, createPowerSaveBlocker } from "./electron/power";
import { electronProcess } from "./electron/process";
import { createProtocols } from "./electron/protocol";
import { createSafeStorage, selectBackend } from "./electron/safe-storage";
import { createSchemeRegistration } from "./electron/schemes";
import type { ListedDisplay } from "./electron/screen";
import { createScreen } from "./electron/screen";
import { createSessions } from "./electron/session";
import { createSessionCalls } from "./electron/session-calls";
import { createShell } from "./electron/shell";
import { createSystemPreferences } from "./electron/system-preferences";
import { createContentTracing, createNetLog } from "./electron/tracing";
import { createTray } from "./electron/tray";
import { UtilityProcess, utilityProcess } from "./electron/utility-process";
import { ELECTRON_VERSION } from "./electron/version";
import { createWebRequests } from "./electron/web-request";
import { connectEngine, connectEngineWhenUp } from "./engine";
import type { Environment } from "./environment";
import { readEnvironment } from "./environment";
import { mirrorResources } from "./mirror";
import { electronPaths } from "./paths";
import { quirksOf } from "./quirks";

/** A window as the app's menus hand it to a click: one of its BrowserWindows. */
type MenuWindow = { readonly close: () => void };

/**
 * How long an app started with the desktop waits for the engine to listen.
 */
const ENGINE_WAIT = 60_000;

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
    const { needsOwnElectron } = quirksOf(pkg.name);
    if (needsOwnElectron !== undefined) {
      unsupported(`${pkg.productName} ${needsOwnElectron}`);
    }
    const configHome = env.XDG_CONFIG_HOME ?? join(home, ".config");
    // How this host was started, so `app.relaunch` can start it again.
    const host = [process.execPath, ...process.argv.slice(1, 3)];
    const { app, hooks, markReady } = createApp({
      appPath,
      env,
      paths: electronPaths({
        env,
        execPath: process.execPath,
        home,
        productName: pkg.productName,
        temp: tmpdir(),
        userDirs: await readOptional(join(configHome, "user-dirs.dirs")),
      }),
      pkg,
      relaunch: (relaunchArgs) => {
        Bun.spawn([...host, ...relaunchArgs], {
          // biome-ignore lint/style/noProcessEnv: a relaunch runs as this host did
          env: process.env,
          stdio: ["ignore", "inherit", "inherit"],
        }).unref();
      },
      runSync: (command) => {
        try {
          const ran = runCommandSync(command, { output: true });
          return {
            code: ran.code,
            output: `${ran.stdout.toString()}${ran.stderr}`,
          };
        } catch (error) {
          // A command the desktop lacks, as a shell answers it.
          return {
            code: 127,
            output: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
    const socket =
      env.DOMICILE_ELECTRON_SOCK ??
      fail(
        "DOMICILE_ELECTRON_SOCK is not set, so there is no desktop to open this app's windows on. Start it from inside a Domicile desktop.",
      );
    const engine = (
      await connectEngineWhenUp(
        () => connectEngine(socket, pkg.appId, `persist:electron-${pkg.name}`),
        ENGINE_WAIT,
      )
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
    const {
      BrowserView,
      BrowserWindow,
      WebContents,
      WebContentsView,
      WebFrameMain,
      webContents,
      webContentsOf,
    } = createBrowserWindow(
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
    const desktopState = subscribeDesktop();
    hooks.focus = () => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.show();
        window.focus();
      }
    };
    hooks.applicationMenu = {
      get: Menu.getApplicationMenu,
      set: (menu) =>
        Menu.setApplicationMenu(
          menu as Parameters<typeof Menu.setApplicationMenu>[0],
        ),
    };
    const electron: Record<string, unknown> = {
      app,
      autoUpdater: createAutoUpdater(),
      BrowserView,
      BrowserWindow,
      clipboard: createClipboard({ run: runCommandSync }),
      contentTracing: createContentTracing(tmpdir),
      crashReporter: createCrashReporter(),
      desktopCapturer,
      dialog: createDialog({
        askMessageBox: async (window, options) => {
          const over = boxWindow(window, BrowserWindow);
          if (over === undefined) {
            // Electron shows it on its own; the engine shows boxes only
            // over a page.
            return unsupported(
              `${app.getName()} shows a message box before any of its windows has a page, which Domicile's engine can't show yet`,
            );
          }
          return await messageBoxes.ask(over, options);
        },
        choose: desktop.choose,
        chooseSync: desktop.chooseSync,
        isDirectory: (path) =>
          statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false,
        printError: (text) => {
          // biome-ignore lint/suspicious/noConsole: Electron's error box on a desktop with no dialog for it, for the supervisor's log
          console.error(text);
        },
      }),
      globalShortcut: createGlobalShortcut(warn),
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
      net,
      netLog: createNetLog(),
      powerMonitor: createPowerMonitor(desktopState.statuses),
      powerSaveBlocker: createPowerSaveBlocker(() => {
        const inhibitor = Bun.spawn(
          ["domicile", "inhibit-idle", "--", "sleep", "infinity"],
          { stdio: ["ignore", "ignore", "inherit"] },
        );
        return { stop: () => inhibitor.kill() };
      }),
      protocol: {
        ...session.defaultSession.protocol,
        registerSchemesAsPrivileged: createSchemeRegistration({
          app: pkg.name,
          recordPath: join(
            env.XDG_STATE_HOME ?? join(home, ".local/state"),
            "domicile/electron-schemes.json",
          ),
          refuse: unsupported,
          registered: engine.schemes,
        }),
      },
      safeStorage: createSafeStorage({
        backend: () =>
          selectBackend(
            app.commandLine.getSwitchValue("password-store"),
            env.XDG_CURRENT_DESKTOP,
            (why) => unsupported(`${pkg.productName} ${why}`),
          ),
        password: () => desktop.safeStoragePassword(app.getName()),
      }),
      screen: createScreen(listDisplays, desktopState.displays),
      session,
      shell: createShell(runCommand),
      systemPreferences: createSystemPreferences(() => false),
      Tray: createTray({
        connect: desktop.connect,
        menus: { click, model },
        name: app.getName,
      }),
      utilityProcess,
      WebContentsView,
      webContents,
    };
    completeElectron(electron, app.getName(), { unsupported, warn });
    completeInstances(
      {
        BrowserView: BrowserView.prototype,
        BrowserWindow: BrowserWindow.prototype,
        Menu: Object.getPrototypeOf(new Menu()),
        MenuItem: Object.getPrototypeOf(new MenuItem({ label: "" })),
        MessagePortMain: MessagePortMain.prototype,
        NativeImage: Object.getPrototypeOf(nativeImage.createEmpty()),
        Notification: (electron.Notification as { prototype: object })
          .prototype,
        Session: Object.getPrototypeOf(session.defaultSession),
        Tray: (electron.Tray as { prototype: object }).prototype,
        UtilityProcess: UtilityProcess.prototype,
        WebContents: WebContents.prototype,
        WebContentsView: WebContentsView.prototype,
        WebFrameMain: WebFrameMain.prototype,
      },
      app.getName(),
      { unsupported, warn },
    );
    Bun.plugin({
      name: "electron",
      setup: (build) => {
        // `default` for `import electron from "electron"`, which Electron's
        // CommonJS module answers with the whole module.
        const exports = { ...electron, default: electron };
        for (const name of ["electron", "electron/main"]) {
          build.module(name, () => ({ exports, loader: "object" }));
        }
      },
    });
    Object.assign(process, electronProcess(mirror));
    Object.assign(process.versions, { electron: ELECTRON_VERSION });
    process.argv = [process.execPath, ...args];
    await import(pkg.main);
    markReady();
  }
};

/** What the app reached for that Electron has and Domicile doesn't do, for its developer. */
const warn = (why: string) => {
  // biome-ignore lint/suspicious/noConsole: an Electron API that does less on Domicile, for the desktop's log
  console.error(`electron-host: ${why}`);
};

/** The desktop's displays now, from `domicile list-displays --json`. */
const listDisplays = (): ListedDisplay[] => {
  const ran = runCommandSync(["domicile", "list-displays", "--json"], {
    output: true,
  });
  if (ran.code !== 0) {
    throw new Error(
      `domicile list-displays failed, so the app can't see the screens: ${ran.stderr.trim()}`,
    );
  }
  return JSON.parse(ran.stdout.toString()) as ListedDisplay[];
};

/**
 * `domicile subscribe displays status`, started the first time a module asks
 * for either, and handed to every module that asked.
 */
const subscribeDesktop = () => {
  const displays: ((listed: readonly ListedDisplay[]) => void)[] = [];
  const statuses: ((status: DesktopStatus) => void)[] = [];
  let started = false;
  const start = () => {
    if (started) {
      return;
    }
    started = true;
    let child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "inherit">>;
    try {
      child = Bun.spawn(["domicile", "subscribe", "displays", "status"], {
        stdio: ["ignore", "pipe", "inherit"],
      });
    } catch (error) {
      warn(
        `can't follow the desktop's displays and lock with domicile subscribe: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    child.unref();
    void (async () => {
      let pending = "";
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        const lines = (pending + decoder.decode(chunk, { stream: true })).split(
          "\n",
        );
        pending = lines.pop() ?? "";
        for (const line of lines.filter((l) => l.trim() !== "")) {
          const message = JSON.parse(line) as {
            type: string;
            displays?: ListedDisplay[];
            status?: DesktopStatus;
          } & DesktopStatus;
          if (
            message.type === "display_list" &&
            message.displays !== undefined
          ) {
            for (const hear of displays) {
              hear(message.displays);
            }
          } else if (message.type === "status") {
            for (const hear of statuses) {
              hear(message.status ?? message);
            }
          }
        }
      }
    })();
  };
  return {
    displays: (hear: (listed: readonly ListedDisplay[]) => void) => {
      displays.push(hear);
      start();
    },
    statuses: (hear: (status: DesktopStatus) => void) => {
      statuses.push(hear);
      start();
    },
  };
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
