// Portal dialogs and the sessions they started: Domicile is the only
// xdg-desktop-portal backend, and the shell draws its dialogs. See
// docs/PORTALS.md.

import type { DomicileHost } from "../domicile-host";
import type {
  BoundShortcut,
  Capturing,
  PortalAnswer,
  PortalRequest,
  PortalWallpaper,
} from "../portal";
import {
  answerPortalRequest,
  stopCapturing,
  watchBoundShortcuts,
  watchCapturing,
  watchPortalRequests,
  watchPortalWallpaper,
} from "./portal-wire";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type PortalsListeners = {
  /** The compositor pushed: read each part again. */
  change: () => void;
};

/** Each part is `undefined` until the compositor's first push. */
export type Portals = {
  /** Every unanswered request, oldest first. */
  readonly requests: readonly PortalRequest[] | undefined;
  /** Every session that controls or captures input. */
  readonly capturing: readonly Capturing[] | undefined;
  /** Every chord applications hold through the GlobalShortcuts portal. */
  readonly boundShortcuts: readonly BoundShortcut[] | undefined;
  /** The pictures applications set through the Wallpaper portal. */
  readonly wallpaper: PortalWallpaper | undefined;
  /** Answer request `id`. The first answer to reach the compositor wins. */
  answer: (id: number, answer: PortalAnswer) => void;
  /** End capturing session `id`. */
  stopCapturing: (id: number) => void;
  /**
   * Tell the application holding bound shortcut `id` its chord went down or
   * up. See {@link Portals.boundShortcuts}.
   */
  fireShortcut: (id: number, kind: "pressed" | "released") => void;
  on: On<PortalsListeners>;
};

export type PortalsHost = Pick<
  DomicileHost,
  "addEventListener" | "answerPortalRequest" | "removeEventListener"
>;

/** Listens from the start: the engine sends the latest push to a new listener. */
export const portals = (host: PortalsHost): Portals => {
  const latest: {
    requests?: readonly PortalRequest[];
    capturing?: readonly Capturing[];
    boundShortcuts?: readonly BoundShortcut[];
    wallpaper?: PortalWallpaper;
  } = {};
  watchPortalRequests(host, (requests) => {
    latest.requests = requests;
  });
  watchCapturing(host, (capturing) => {
    latest.capturing = capturing;
  });
  watchBoundShortcuts(host, (boundShortcuts) => {
    latest.boundShortcuts = boundShortcuts;
  });
  watchPortalWallpaper(host, (wallpaper) => {
    latest.wallpaper = wallpaper;
  });
  return {
    answer: (id, answer) => {
      answerPortalRequest(host, id, answer);
    },
    get boundShortcuts() {
      return latest.boundShortcuts;
    },
    get capturing() {
      return latest.capturing;
    },
    fireShortcut: (id, kind) => {
      host.answerPortalRequest(id, JSON.stringify({ kind }));
    },
    on: on<PortalsListeners>({
      change: (listener) => hostEvent(host, "portalrequests", () => listener()),
    }),
    get requests() {
      return latest.requests;
    },
    stopCapturing: (id) => {
      stopCapturing(host, id);
    },
    get wallpaper() {
      return latest.wallpaper;
    },
  };
};
