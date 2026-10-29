// A minimal shell: every app is full-screen, with the newest on top, a box to
// start apps and a terminal on Meta+Enter.
//
// Domicile calls the `Shell` export with the element to draw `<app>` elements
// in. See /docs/WRITING-A-SHELL.md.

import type { ClientWindow } from "@domicile-desktop/sdk/desktop/windows";
import { PortalAnswer, PortalKind } from "@domicile-desktop/sdk/portal";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

/** The chord that opens a terminal. */
const TERMINAL_CHORD = "Meta+Return";

/** Draws the desktop into `root`, Domicile's empty `<body>`. */
export const Shell: ShellModule = (root, domicile) => {
  // `<app>` is the engine's tag; the engine sends the pointer and keyboard
  // over one to its client.

  /** Mounted `<app>` elements by app id. */
  const mounted = new Map<string, HTMLElement>();

  /** Shows what `domicile.windows.list` holds, in its order. */
  const show = () => {
    const windows = domicile.windows.list;
    for (const [appId, element] of mounted) {
      if (!windows.some((window) => window.appId === appId)) {
        element.remove();
        mounted.delete(appId);
      }
    }
    for (const window of windows) {
      let element = mounted.get(window.appId);
      if (element === undefined) {
        element = document.createElement("app");
        element.setAttribute("app-id", window.appId);
        // The elements share a stacking context, so appending puts it on top.
        // Append only once: moving an `<app>` in the tree embeds it again.
        root.append(element);
        mounted.set(window.appId, element);
      }
      if (window.parent !== undefined) {
        placePopup(element, window, windows);
      }
    }
  };

  show();
  domicile.windows.on("change", show);

  // A box that runs the command typed in it, such as `firefox`. Fixed, so it
  // stays above every window.
  const input = document.createElement("input");
  input.placeholder = "Run an app, like firefox";
  const launcher = document.createElement("form");
  launcher.style.cssText =
    "bottom: 16px; left: 50%; position: fixed; translate: -50%; z-index: 1";
  launcher.append(input);
  launcher.addEventListener("submit", (event) => {
    event.preventDefault();
    const argv = input.value.split(" ").filter((word) => word !== "");
    if (argv.length > 0) {
      domicile.processes.launch(argv);
    }
    launcher.reset();
  });
  root.append(launcher);

  // A terminal on Meta+Enter. Change `kitty` to your terminal.
  domicile.keyboard.grab(TERMINAL_CHORD);
  domicile.keyboard.on("shortcut", ({ chord }) => {
    if (chord === TERMINAL_CHORD) {
      domicile.processes.launch(["kitty"]);
    }
  });

  // This shell draws no dialogs, so it refuses what applications ask through
  // the desktop portal rather than leave them waiting. Inhibitors ask nothing.
  // A React shell mounts `PortalDialogs` from
  // `@domicile-desktop/component-library` instead.
  const refuse = () => {
    for (const request of domicile.portals.requests ?? []) {
      if (request.kind !== PortalKind.Inhibit) {
        domicile.portals.answer(request.id, PortalAnswer.Refused());
      }
    }
  };
  refuse();
  domicile.portals.on("change", refuse);
};

/**
 * Places a popup (a menu or tooltip). Popup positions are relative to their
 * parent and windows start at (0, 0), so a popup's origin is the sum of the
 * offsets up its parent chain.
 */
const placePopup = (
  element: HTMLElement,
  popup: ClientWindow,
  windows: readonly ClientWindow[],
): void => {
  const [x, y] = originOf(popup, windows);
  Object.assign(element.style, {
    height: `${(popup.height ?? 0).toString()}px`,
    left: `${x.toString()}px`,
    top: `${y.toString()}px`,
    width: `${(popup.width ?? 0).toString()}px`,
  });
};

/** The absolute origin of `window`'s box. */
const originOf = (
  window: ClientWindow,
  windows: readonly ClientWindow[],
): readonly [x: number, y: number] => {
  const parent = windows.find((candidate) => candidate.appId === window.parent);
  const [x, y] = parent === undefined ? [0, 0] : originOf(parent, windows);
  return [x + (window.x ?? 0), y + (window.y ?? 0)];
};
