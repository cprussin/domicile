// The whole of this shell: an `<app>` per client the host announces, moved and
// resized on the Alt key, and Alt+Enter for a terminal.

import { APP_TAG_NAME } from "@domicile/chrome-sdk/app-element";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { DomicileShortcut } from "@domicile/chrome-sdk/domicile-host";
import { focusApp } from "@domicile/chrome-sdk/focus-app";
import type { CSSProperties, PointerEvent } from "react";
import { Fragment, useEffect, useRef, useState } from "react";

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

/** Alt+Enter in the evdev keycodes the control channel speaks; 28 is Enter. */
const ALT_ENTER: DomicileShortcut = {
  altKey: true,
  ctrlKey: false,
  keycode: 28,
  metaKey: false,
  shiftKey: false,
};

const KEYBINDINGS = [
  ["Alt + press", "raise"],
  ["Alt + drag", "move (and raise)"],
  ["Alt + right-drag", "resize (and raise)"],
  ["Alt + Enter", "open a terminal"],
] as const;

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
 * The pointer handlers run on the desktop rather than on each window, and stop
 * what they take: an `<app>` forwards every pointer event over it straight to
 * the client underneath, so an un-taken Alt-drag also clicks into the client
 * and leaves it holding a button that never comes up.
 */
export const Shell = ({ domicile }: { domicile: DomicileClient }) => {
  const [windows, setWindows] = useState<readonly ShellWindow[]>([]);
  // Which ids are open, kept in step synchronously: two announcements in one
  // tick would otherwise both find the state empty and open the same window.
  const open = useRef(new Set<string>());
  // Every chrome is replayed the windows already running, then told who holds
  // the keyboard. Only a window after that is one the user just opened.
  const caughtUp = useRef(false);
  const drag = useRef<Drag | undefined>(undefined);

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
    domicile.on("app_closed", ({ app_id }) => {
      open.current.delete(app_id);
      setWindows((all) => all.filter((window) => window.appId !== app_id));
    });
    // The size is the SDK's, recorded as the message goes past; what reaches
    // here is that the window has stopped being empty.
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

    // Alt+Enter is claimed twice because the keyboard is in two places: the
    // page hears it until a client has focus, and the compositor after that.
    const openTerminal = () => {
      domicile.spawn(TERMINAL_COMMAND);
    };
    domicile.grabShortcut(ALT_ENTER);
    domicile.on("shortcut", openTerminal);
    // On `document`, because a key event never reaches an element — a Wayland
    // client is a surface with nowhere to put focus — and in the capture phase,
    // so the chord is taken before the SDK forwards it to the focused window.
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAltEnter(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          openTerminal();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [domicile]);

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
 * Where a newly announced client's window opens.
 *
 * A Wayland client says nothing about where it goes, and nothing about how big
 * it is until it draws — so this cascades off the windows already open, and
 * takes a size only from the replay a reconnecting chrome is given.
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
    // A size is a client that has drawn, and no frame is coming to say so: the
    // hand-over skips a natively-drawn window, and `app_resized` fires only on
    // a size that changed.
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

const take = (event: PointerEvent<HTMLDivElement>): void => {
  event.preventDefault();
  event.stopPropagation();
};

/** Every modifier is part of the chord, exactly as {@link ALT_ENTER} claims it. */
const isAltEnter = (event: KeyboardEvent): boolean =>
  event.key === "Enter" &&
  event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey;
