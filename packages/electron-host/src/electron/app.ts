// The stand-in for Electron's `app`: the app's identity, paths, lifecycle and
// command-line switches.

import { EventEmitter } from "node:events";

import type { AppPackage } from "../app-package";
import type { PathName } from "../paths";

export type AppOptions = {
  /** The app directory: the mirror's extracted `app.asar`. */
  readonly appPath: string;
  readonly exit?: (code: number) => void;
  readonly pkg: AppPackage;
  readonly paths: Readonly<Record<PathName, string>>;
};

/**
 * The `app` an Electron app sees, and `markReady`, which the host calls once
 * the engine can open windows.
 */
export const createApp = ({
  appPath,
  exit = (code) => process.exit(code),
  pkg,
  paths,
}: AppOptions) => {
  const app = new ElectronApp(appPath, exit, pkg, paths);
  return { app, markReady: () => app.markReady() };
};

/**
 * Electron's `app`. A class because the app listens on it as an
 * `EventEmitter` and reads and sets `name` as a property.
 */
export class ElectronApp extends EventEmitter {
  readonly commandLine = commandLine();
  readonly isPackaged = true;
  #name: string;
  #paths: Map<string, string>;
  #ready = Promise.withResolvers<void>();
  #isReady = false;

  constructor(
    private readonly appPath: string,
    private readonly exitWith: (code: number) => void,
    private readonly pkg: AppPackage,
    paths: Readonly<Record<PathName, string>>,
  ) {
    super();
    this.#name = pkg.productName;
    this.#paths = new Map(Object.entries(paths));
  }

  get name() {
    return this.#name;
  }

  set name(name: string) {
    this.#name = name;
  }

  readonly exit = (code = 0) => {
    this.exitWith(code);
  };

  readonly getAppPath = () => this.appPath;

  readonly getName = () => this.#name;

  readonly getPath = (name: string) => {
    const path = this.#paths.get(name);
    if (path === undefined) {
      throw new Error(`Failed to get '${name}' path`);
    } else {
      return path;
    }
  };

  readonly getVersion = () => this.pkg.version;

  readonly isReady = () => this.#isReady;

  readonly markReady = () => {
    this.#isReady = true;
    this.#ready.resolve();
    this.emit("ready", eventObject(), {});
  };

  readonly quit = () => {
    const beforeQuit = eventObject();
    this.emit("before-quit", beforeQuit);
    if (!beforeQuit.defaultPrevented) {
      this.emit("will-quit", eventObject());
      this.emit("quit", eventObject(), 0);
      this.exitWith(0);
    }
  };

  readonly setName = (name: string) => {
    this.#name = name;
  };

  readonly setPath = (name: string, path: string) => {
    this.#paths.set(name, path);
  };

  readonly whenReady = () => this.#ready.promise;
}

/** `app.commandLine`: switches the app appends for Chromium. */
const commandLine = () => {
  const switches = new Map<string, string>();
  return {
    appendSwitch: (name: string, value = "") => {
      switches.set(name, value);
    },
    getSwitchValue: (name: string) => switches.get(name) ?? "",
    hasSwitch: (name: string) => switches.has(name),
    removeSwitch: (name: string) => {
      switches.delete(name);
    },
  };
};

/** The event object Electron passes first to an `app` listener. */
const eventObject = () => {
  const event = {
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };
  return event;
};
