// A minimal shell: one `<app>` per client the host announces, moved and resized
// with Alt, and a terminal on Alt+Enter.

import { APP_TAG_NAME } from "@domicile-desktop/sdk/app-element";
import { bindKeys } from "@domicile-desktop/sdk/bind-keys";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { focusApp } from "@domicile-desktop/sdk/focus-app";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { CSSProperties, PointerEvent } from "react";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";

// `<app>` is the engine's tag. It has no hyphen, so it is not a custom element
// and React has no JSX type for it. The focus event is not declared: React
// treats a hyphenless tag as plain HTML and sets no `on…` prop for an unknown
// event.
declare module "react" {
  // biome-ignore lint/style/noNamespace: React declares its JSX types as a namespace; augmenting IntrinsicElements has to match that shape
  namespace JSX {
    // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into IntrinsicElements requires an interface
    interface IntrinsicElements {
      /** A Wayland client's window. `app-id` is the host's name for it. */
      app: DetailedHTMLProps<HTMLAttributes<HTMLAppElement>, HTMLAppElement> & {
        "app-id": string;
      };
    }
  }
}

/** Offset between cascaded windows, and how many before the cascade wraps. */
const CASCADE_STEP = 32;
const CASCADE_LENGTH = 8;

/** Window size before the client commits one. */
const OPENING_SIZE = [640, 480] as const;

/** Smallest resize. Below this there is no corner left to drag. */
const MINIMUM_SIZE = 32;

/** The pointer button that resizes rather than moves. */
const SECONDARY_BUTTON = 2;

const TERMINAL_COMMAND = ["kitty"] as const;

/** Prefix for errors about unknown commands. */
const SHELL = "simple";

/** Default bindings: Alt+Enter opens a terminal. */
const SIMPLE_KEYS: ShellKeybindings = {
  keybindings: { "Alt+Return": KeyAction.SendShell(["terminal"]) },
};

/** Bindings listed in the background legend. */
const KEYBINDINGS = [
  ["Alt + press", "raise"],
  ["Alt + drag", "move (and raise)"],
  ["Alt + right-drag", "resize (and raise)"],
  ["Alt + Enter", "open a terminal"],
] as const;

/** Default reporter for unknown commands. */
const logToConsole = (error: string): void => {
  // biome-ignore lint/suspicious/noConsole: the bindings are the user's, and the console is where a shell reports an unknown command in them
  console.error(error);
};

/** A window on the desktop: its placement and client state. */
type ShellWindow = {
  appId: string;
  cursor: string | undefined;
  drawn: boolean;
  height: number;
  left: number;
  top: number;
  width: number;
  z: number;
};

/**
 * A popup, such as a menu or tooltip, over one of a client's windows. It is
 * placed at an offset from its parent and is never dragged, raised or focused.
 */
type Popup = {
  appId: string;
  parent: string;
  position: readonly [x: number, y: number];
  size: readonly [width: number, height: number];
};

/** A drag in progress, measured from the grab point so steps do not drift. */
type Drag = {
  appId: string;
  fromX: number;
  fromY: number;
  grabbed: ShellWindow;
  resizing: boolean;
};

/**
 * The desktop: every window the host has announced.
 *
 * Pointer handlers sit on the desktop and stop the events they handle. An
 * `<app>` forwards pointer events to its client, so an unhandled Alt-drag would
 * also click the client and leave a button stuck down.
 */
export const Shell = ({
  domicile,
  keybindings = SIMPLE_KEYS,
  report = logToConsole,
}: {
  domicile: DomicileClient;
  /** Key bindings. Defaults to Alt+Enter for a terminal. */
  keybindings?: ShellKeybindings | undefined;
  /** Reports unknown commands. Injectable for tests. */
  report?: typeof logToConsole;
}) => {
  const [windows, setWindows] = useState<readonly ShellWindow[]>([]);
  const [popups, setPopups] = useState<readonly Popup[]>([]);
  // Open ids, updated synchronously. Otherwise two announcements in one tick
  // would both see empty state and open the same window.
  const open = useRef(new Set<string>());
  // A chrome first gets a replay of running windows, then `focus_changed`. Only
  // windows announced after that were just opened by the user.
  const caughtUp = useRef(false);
  const drag = useRef<Drag | undefined>(undefined);

  // Handles the shell's one command. An effect event, so it reads current props
  // without rebinding the keys.
  const onCommand = useEffectEvent((args: readonly string[]) => {
    if (args.join(" ") === "terminal") {
      domicile.spawn(TERMINAL_COMMAND);
    } else {
      report(`${SHELL}: no command \`${args.join(" ")}\``);
    }
  });

  useEffect(() => {
    domicile.on("app_appeared", ({ app_id, size }) => {
      if (!open.current.has(app_id)) {
        open.current.add(app_id);
        setWindows((all) => [...all, opened(app_id, size, all)]);
        if (caughtUp.current) {
          focusApp(domicile, app_id);
        }
      }
    });
    domicile.on("popup_placed", ({ app_id, parent, position, size }) => {
      setPopups((all) => [
        ...all.filter((popup) => popup.appId !== app_id),
        { appId: app_id, parent, position, size },
      ]);
    });
    domicile.on("app_closed", ({ app_id }) => {
      open.current.delete(app_id);
      setWindows((all) => all.filter((window) => window.appId !== app_id));
      setPopups((all) => all.filter((popup) => popup.appId !== app_id));
    });
    // The SDK records the size. Here it only marks the window as drawn.
    domicile.on("app_resized", ({ app_id }) => {
      setWindows((all) =>
        withWindow(all, app_id, (window) => ({ ...window, drawn: true })),
      );
    });
    domicile.on("app_cursor", ({ app_id, cursor }) => {
      setWindows((all) =>
        withWindow(all, app_id, (window) => ({ ...window, cursor })),
      );
    });
    domicile.on("focus_changed", () => {
      caughtUp.current = true;
    });

    // The SDK resolves the chord against the compositor's keymap and handles
    // the press whether it reaches the page or the compositor.
    return bindKeys(domicile, keybindings, {
      onCommand,
      // This shell has no modes to show.
      onModeChanged: () => undefined,
    }).unbind;
  }, [domicile, keybindings]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const window = event.altKey ? windowAt(windows, event.target) : undefined;
    if (window !== undefined) {
      take(event);
      // Capture routes later events for this pointer here and guarantees the
      // release that ends the drag.
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        appId: window.appId,
        fromX: event.clientX,
        fromY: event.clientY,
        grabbed: window,
        resizing: event.button === SECONDARY_BUTTON,
      };
      setWindows((all) =>
        withWindow(all, window.appId, (raised) => ({
          ...raised,
          z: frontmost(all) + 1,
        })),
      );
    }
  };

  const continueDrag = (event: PointerEvent<HTMLDivElement>) => {
    const dragging = drag.current;
    if (dragging !== undefined) {
      take(event);
      setWindows((all) =>
        withWindow(all, dragging.appId, (window) =>
          draggedTo(dragging, window, event.clientX, event.clientY),
        ),
      );
    }
  };

  // Capture is released implicitly on up and cancel. If the client exits
  // mid-drag, its window leaves the list and the moves stop applying.
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== undefined) {
      // The client never saw the button go down, so it must not see it go up.
      take(event);
      drag.current = undefined;
    }
  };

  return (
    <div
      onPointerCancel={endDrag}
      onPointerDown={startDrag}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
    >
      <Keys />
      {windows.map((window) => (
        <app
          app-id={window.appId}
          data-drawn={window.drawn ? "" : undefined}
          key={window.appId}
          style={styleOf(window)}
        />
      ))}
      {popups.map((popup) => {
        const style = popupStyleOf(popup, popups, windows);
        return style === undefined ? undefined : (
          <app app-id={popup.appId} key={popup.appId} style={style} />
        );
      })}
    </div>
  );
};

/** The key legend, drawn behind all windows. */
const Keys = () => (
  <dl className="keys">
    {KEYBINDINGS.map(([chord, means]) => (
      <Fragment key={chord}>
        <dt>{chord}</dt>
        <dd>{means}</dd>
      </Fragment>
    ))}
  </dl>
);

/**
 * The initial placement of a newly announced window.
 *
 * A Wayland client gives no position, and no size until it draws. Windows
 * cascade off the open ones and take a size only from a replay to a
 * reconnecting chrome.
 */
const opened = (
  appId: string,
  size: readonly [width: number, height: number] | undefined,
  windows: readonly ShellWindow[],
): ShellWindow => {
  const step = CASCADE_STEP * (windows.length % CASCADE_LENGTH);
  const [width, height] = size ?? OPENING_SIZE;
  return {
    appId,
    cursor: undefined,
    // A size means the client has drawn, and no frame will say so: the
    // hand-over skips natively drawn windows, and `app_resized` fires only when
    // the size changes.
    drawn: size !== undefined,
    height,
    left: step,
    top: step,
    width,
    z: frontmost(windows) + 1,
  };
};

const withWindow = (
  windows: readonly ShellWindow[],
  appId: string,
  change: (window: ShellWindow) => ShellWindow,
): readonly ShellWindow[] =>
  windows.map((window) => (window.appId === appId ? change(window) : window));

const frontmost = (windows: readonly ShellWindow[]): number =>
  windows.reduce((top, window) => Math.max(top, window.z), 0);

/** The window an event landed in, usually on its client's canvas. */
const windowAt = (
  windows: readonly ShellWindow[],
  target: EventTarget,
): ShellWindow | undefined => {
  const element =
    target instanceof Element ? target.closest(APP_TAG_NAME) : undefined;
  const appId = element?.getAttribute("app-id");
  return windows.find((window) => window.appId === appId);
};

const draggedTo = (
  drag: Drag,
  window: ShellWindow,
  x: number,
  y: number,
): ShellWindow => {
  const dx = x - drag.fromX;
  const dy = y - drag.fromY;
  if (drag.resizing) {
    return {
      ...window,
      height: Math.max(MINIMUM_SIZE, drag.grabbed.height + dy),
      width: Math.max(MINIMUM_SIZE, drag.grabbed.width + dx),
    };
  } else {
    return {
      ...window,
      left: drag.grabbed.left + dx,
      top: drag.grabbed.top + dy,
    };
  }
};

const styleOf = ({
  cursor,
  height,
  left,
  top,
  width,
  z,
}: ShellWindow): CSSProperties => ({
  cursor,
  height,
  left,
  top,
  width,
  zIndex: z,
});

/**
 * A popup's style: its offsets summed up to a window, at that window's z-index.
 * Popups render after all windows, so they win the tie. `undefined` while the
 * window is not open.
 */
const popupStyleOf = (
  popup: Popup,
  popups: readonly Popup[],
  windows: readonly ShellWindow[],
): CSSProperties | undefined => {
  const over = originOf(popup.parent, popups, windows);
  return over === undefined
    ? undefined
    : {
        height: popup.size[1],
        left: over.left + popup.position[0],
        top: over.top + popup.position[1],
        width: popup.size[0],
        zIndex: over.z,
      };
};

/** The top-left of `appId`'s box, and its window's z-index. */
const originOf = (
  appId: string,
  popups: readonly Popup[],
  windows: readonly ShellWindow[],
): { left: number; top: number; z: number } | undefined => {
  const popup = popups.find((candidate) => candidate.appId === appId);
  if (popup === undefined) {
    const window = windows.find((candidate) => candidate.appId === appId);
    return window === undefined
      ? undefined
      : { left: window.left, top: window.top, z: window.z };
  } else {
    const over = originOf(popup.parent, popups, windows);
    return over === undefined
      ? undefined
      : {
          left: over.left + popup.position[0],
          top: over.top + popup.position[1],
          z: over.z,
        };
  }
};

const take = (event: PointerEvent<HTMLDivElement>): void => {
  event.preventDefault();
  event.stopPropagation();
};
