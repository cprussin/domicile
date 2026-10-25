// The desktop a shell is handed, typed and grouped by what it is about. See
// docs/WRITING-A-SHELL.md.

import type { DomicileHost } from "../domicile-host";
import { system } from "../system";
import type { AppearanceNamespace } from "./appearance";
import { appearance } from "./appearance";
import type { Browser } from "./browser";
import { browser } from "./browser";
import type { Capture } from "./capture";
import { capture } from "./capture";
import type { Clipboard } from "./clipboard";
import { clipboard } from "./clipboard";
import type { Dbus } from "./dbus";
import { dbus } from "./dbus";
import type { Displays } from "./displays";
import { displays } from "./displays";
import type { Extensions } from "./extensions";
import { extensions } from "./extensions";
import type { Files } from "./files";
import { files } from "./files";
import type { Keyboard } from "./keyboard";
import { keyboard } from "./keyboard";
import type { Notifications } from "./notifications";
import { notifications } from "./notifications";
import type { Pointer } from "./pointer";
import { pointer } from "./pointer";
import type { Portals } from "./portals";
import { portals } from "./portals";
import type { Processes } from "./processes";
import { processes } from "./processes";
import type { Session } from "./session";
import { session } from "./session";
import type { ShellNamespace } from "./shell";
import { shell } from "./shell";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";
import type { Theme } from "./theme";
import { theme } from "./theme";
import type { Tray } from "./tray";
import { tray } from "./tray";
import type { Windows } from "./windows";
import { windows } from "./windows";

export type DomicileListeners = {
  /**
   * The compositor exited and a new one took over, after every window and
   * system call of the old one ended. Calls that listen listen again.
   */
  compositorreplaced: () => void;
};

/**
 * The desktop: one namespace per subject. State is read from attributes,
 * which say `change` through `on`; a call that can fail resolves a `Result`.
 */
export type Domicile = {
  readonly appearance: AppearanceNamespace;
  readonly browser: Browser;
  readonly capture: Capture;
  readonly clipboard: Clipboard;
  readonly dbus: Dbus;
  readonly displays: Displays;
  readonly extensions: Extensions;
  readonly files: Files;
  readonly keyboard: Keyboard;
  readonly notifications: Notifications;
  readonly pointer: Pointer;
  readonly portals: Portals;
  readonly processes: Processes;
  readonly session: Session;
  readonly shell: ShellNamespace;
  readonly theme: Theme;
  readonly tray: Tray;
  readonly windows: Windows;
  on: On<DomicileListeners>;
};

/** The desktop `host` describes: the same object for each call on a host. */
export const desktop = (host: DomicileHost): Domicile => {
  const known = built.get(host);
  if (known === undefined) {
    const made = build(host);
    built.set(host, made);
    return made;
  } else {
    return known;
  }
};

/** One per host, so its portal listeners and system call ids are shared. */
const built = new WeakMap<DomicileHost, Domicile>();

const build = (host: DomicileHost): Domicile => {
  const calls = system(host);
  return {
    appearance: appearance(host),
    browser: browser(host),
    capture: capture(calls),
    clipboard: clipboard(host),
    dbus: dbus(calls),
    displays: displays(host, calls),
    extensions: extensions(host),
    files: files(host, calls),
    keyboard: keyboard(host),
    notifications: notifications(host),
    on: on<DomicileListeners>({
      compositorreplaced: (listener) =>
        hostEvent(host, "compositorreplaced", () => listener()),
    }),
    pointer: pointer(host),
    portals: portals(host),
    processes: processes(host, calls),
    session: session(host, calls),
    shell: shell(host, calls),
    theme: theme(host),
    tray: tray(host, calls),
    windows: windows(host, calls),
  };
};
