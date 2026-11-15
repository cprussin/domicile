// The windows of a test app, on an engine that records what it is sent.

import { EventEmitter } from "node:events";

import type { Engine, EngineRequest, WindowEvent } from "../engine";
import { electronPaths } from "../paths";
import { createApp } from "./app";
import { createBrowserWindow } from "./browser-window";
import { createIpcMain } from "./ipc-main";
import { createMenu } from "./menu";
import { createPermissions } from "./permissions";
import { createProtocols } from "./protocol";
import { createSessions } from "./session";
import { createSessionCalls } from "./session-calls";
import { createWebRequests } from "./web-request";

export const setUp = ({ refuse }: { refuse?: (why: string) => never } = {}) => {
  const sent: EngineRequest[] = [];
  const events: Engine["events"] = new EventEmitter();
  const exits: number[] = [];
  const { app } = createApp({
    appPath: "/cache/x/resources/app.asar",
    exit: (code) => exits.push(code),
    paths: electronPaths({
      env: {},
      execPath: "/bin/bun",
      home: "/home/me",
      productName: "Notes",
      temp: "/tmp",
      userDirs: undefined,
    }),
    pkg: {
      appId: "com.example.Notes",
      main: "/cache/x/resources/app.asar/main.js",
      name: "notes",
      productName: "Notes",
      version: "1.0.0",
    },
  });
  const { ipcMain, ...ipc } = createIpcMain();
  const sessions = createSessions(
    createProtocols((request) => sent.push(request)),
    createWebRequests(
      (message) => sent.push(message),
      () => undefined,
    ),
    createSessionCalls((message) => sent.push(message)),
    createPermissions(
      (message) => sent.push(message),
      () => undefined,
      () => undefined,
    ),
  );
  // The default session's file: handler, which every test would start with.
  sent.length = 0;
  const menus = createMenu<{ readonly id: number }>({
    appName: () => "Notes",
    focusedWindow: () => null,
    roles: {},
    setApplicationMenu: (menu) => {
      for (const window of windows.BrowserWindow.getAllWindows()) {
        window.setMenu(menu);
      }
    },
  });
  const windows = createBrowserWindow(
    { events, send: (request) => sent.push(request) },
    app,
    ipc,
    sessions,
    {
      applicationMenu: menus.Menu.getApplicationMenu,
      click: (menu, command, window) => {
        menus.click(
          menu,
          command,
          undefined,
          windows.BrowserWindow.fromId(window),
        );
      },
      model: menus.model,
    },
    (path) => `source of ${path}`,
    refuse,
  );
  const say = (event: WindowEvent) => events.emit("window", event);
  return { ...windows, app, exits, ipcMain, menus, say, sent, sessions };
};
