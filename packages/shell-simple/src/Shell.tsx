// The whole of this shell: an `<app>` per client the host announces, moved and
// resized on the Alt key, and a terminal on Alt+Enter.

import { APP_TAG_NAME } from "@domicile-desktop/sdk/app-element";
import { bindKeys } from "@domicile-desktop/sdk/bind-keys";
import type {
  DomicileHost,
  DomicileWindow,
} from "@domicile-desktop/sdk/domicile-host";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { CSSProperties, PointerEvent } from "react";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";

// `<app>` is the engine's own tag, not a custom element — a custom element's
// name must contain a hyphen — so React has no entry for it and this is what
// lets the shell write it at all. Its focus event is deliberately absent: React
// treats a hyphenless tag as ordinary HTML and writes no `on…` prop for an
// event it has never heard of.
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

/** How far each window opens off the last, and how many before it wraps. */
const CASCADE_STEP = 32;
const CASCADE_LENGTH = 8;

/** What a window opens at when its client has not committed a size. */
const OPENING_SIZE = [640, 480] as const;

/** Below this a resized window has no corner left to drag back out. */
const MINIMUM_SIZE = 32;

/** The pointer button that resizes rather than moves. */
const SECONDARY_BUTTON = 2;

const TERMINAL_COMMAND = ["kitty"] as const;

/** What a command this shell does not know is said as coming from. */
const SHELL = "simple";

/** The keys this shell binds: one, for a terminal. */
const SIMPLE_KEYS: ShellKeybindings = {
  keybindings: { "Alt+Return": KeyAction.SendShell(["terminal"]) },
};

/** What the desktop answers to, drawn in the background. */
const KEYBINDINGS = [
  ["Alt + press", "raise"],
  ["Alt + drag", "move (and raise)"],
  ["Alt + right-drag", "resize (and raise)"],
  ["Alt + Enter", "open a terminal"],
] as const;

/** Where a command a binding names and this shell does not know is said. */
const logToConsole = (error: string): void => {
  // biome-ignore lint/suspicious/noConsole: the bindings are the user's, and the console is where a shell tells them one named nothing
  console.error(error);
};

/** A window on the desktop: where this shell put it, and what its client said. */
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
 * A popup a client opened over one of its windows — a menu, a tooltip. Not a
 * window: it is drawn at its offset from what it is over, and is never dragged,
 * raised or given the keyboard by this shell.
 */
type Popup = {
  appId: string;
  parent: string;
  position: readonly [x: number, y: number];
  size: readonly [width: number, height: number];
};

/** A drag in progress, measured from the grab so small steps cannot drift. */
type Drag = {
  appId: string;
  fromX: number;
  fromY: number;
  grabbed: ShellWindow;
  resizing: boolean;
};

/**
 * The desktop: every window the host has announced, and nothing else.
 *
 * The pointer handlers run on the desktop rather than on each window, and take
 * what they handle with `preventDefault()`: an `<app>` forwards every pointer
 * event over it that the page left alone to the client underneath, so an
 * un-taken Alt-drag also clicks into the client and leaves it holding a button
 * that never comes up.
 */
export const Shell = ({
  domicile,
  keybindings = SIMPLE_KEYS,
  report = logToConsole,
}: {
  domicile: DomicileHost;
  /** The keys it binds: Alt+Enter for a terminal when not given. */
  keybindings?: ShellKeybindings | undefined;
  /** Where an unknown command is reported. Injected so a test can read it. */
  report?: typeof logToConsole;
}) => {
  const [windows, setWindows] = useState<readonly ShellWindow[]>([]);
  const [popups, setPopups] = useState<readonly Popup[]>([]);
  const drag = useRef<Drag | undefined>(undefined);

  // The one command this shell has. Read when a key is pressed rather than
  // bound with the keys, which are bound once.
  const onCommand = useEffectEvent((args: readonly string[]) => {
    if (args.join(" ") === "terminal") {
      domicile.spawn(TERMINAL_COMMAND);
    } else {
      report(`${SHELL}: no command \`${args.join(" ")}\``);
    }
  });

  useEffect(() => {
    // A page that has just connected is replayed the windows already running,
    // then told who holds the keyboard. Only a window after that is one the
    // user just opened, and gets the keyboard.
    let caughtUp = false;
    // Which ids are open, kept in step synchronously: the state updater runs
    // later, and the focus decision is made now.
    const open = new Set<string>();

    const listed = () => {
      const all = domicile.windows;
      const toplevels = all.filter((window) => window.parent === null);
      for (const window of toplevels) {
        if (!open.has(window.appId)) {
          open.add(window.appId);
          if (caughtUp) {
            domicile.focusApp(window.appId);
          }
        }
      }
      for (const appId of open) {
        if (!toplevels.some((window) => window.appId === appId)) {
          open.delete(appId);
        }
      }
      setWindows((shown) => kept(shown, toplevels));
      setPopups(all.flatMap(popupOf));
    };
    const focused = () => {
      caughtUp = true;
    };

    listed();
    domicile.addEventListener("windowschanged", listed);
    domicile.addEventListener("focusedwindowchanged", focused);
    // The engine finds the chord's key on the keyboard, and hands back its
    // press by whichever path it took.
    const keys = bindKeys(domicile, keybindings, {
      onCommand,
      // A desktop with one command has no modes to draw.
      onModeChanged: () => undefined,
    });
    return () => {
      domicile.removeEventListener("windowschanged", listed);
      domicile.removeEventListener("focusedwindowchanged", focused);
      keys.unbind();
    };
  }, [domicile, keybindings]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const window = event.altKey ? windowAt(windows, event.target) : undefined;
    if (window !== undefined) {
      take(event);
      // Every later event for this pointer lands here whatever it is over, and
      // the browser guarantees the release that ends the drag.
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

  // Capture is released implicitly on both of these, so there is nothing to
  // undo but the drag itself. A client that exits mid-drag needs nothing
  // either: its window is gone from the list, so the moves stop landing.
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== undefined) {
      // Taken too: the client was never told the button went down.
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

/** What the keys do, painted into the desktop behind whatever opens on it. */
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
 * The windows to show for `listed`: each one already shown where this shell
 * put it, with what its client has said since; each new one opened.
 */
const kept = (
  shown: readonly ShellWindow[],
  listed: readonly DomicileWindow[],
): readonly ShellWindow[] =>
  listed.reduce<readonly ShellWindow[]>((all, window) => {
    const was = shown.find((candidate) => candidate.appId === window.appId);
    const drawn = window.width !== null;
    return [
      ...all,
      was === undefined
        ? opened(window, all)
        : { ...was, cursor: window.cursor, drawn },
    ];
  }, []);

/** A popup the engine lists, or nothing for a window. */
const popupOf = (window: DomicileWindow): readonly Popup[] =>
  window.parent === null
    ? []
    : [
        {
          appId: window.appId,
          parent: window.parent,
          position: [window.x ?? 0, window.y ?? 0],
          size: [window.width ?? 0, window.height ?? 0],
        },
      ];

/**
 * Where a newly announced client's window opens.
 *
 * A Wayland client says nothing about where it goes, and nothing about how big
 * it is until it draws — so this cascades off the windows already open, and
 * takes a size only from the replay a reconnecting chrome is given.
 */
const opened = (
  { appId, cursor, height: drawnHeight, width: drawnWidth }: DomicileWindow,
  windows: readonly ShellWindow[],
): ShellWindow => {
  const step = CASCADE_STEP * (windows.length % CASCADE_LENGTH);
  const [width, height] =
    drawnWidth === null || drawnHeight === null
      ? OPENING_SIZE
      : [drawnWidth, drawnHeight];
  return {
    appId,
    cursor,
    drawn: drawnWidth !== null,
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

/** The window an event landed in — usually on the canvas its client draws to. */
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
 * Where a popup goes: its offset from what it is over, added up to a window,
 * at that window's depth — and after every window in the document, so it wins
 * the tie. `undefined` while its window is not open here.
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

/** The top-left of `appId`'s box, and the depth of its window. */
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
