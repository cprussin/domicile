import type { DomicileWindow } from "@domicile-desktop/sdk/domicile-host";

import type { FloatingRules } from "./floating/floating-rules";
import { opensFloating } from "./floating/floating-rules";
import type { Popup } from "./popup";
import type { SizeLimit } from "./window";
import type { WindowAction as Action } from "./window-state";
import { WindowAction } from "./window-state";

/**
 * The window actions between two host window lists: appearances and changes
 * in `after`'s order, then closings.
 *
 * The host lists every window after any change; the reducer takes individual
 * events. A popup is placed rather than announced, since it is drawn over its
 * window, not laid out. A window `rules` or its client marks opens floating.
 */
export const windowChanges = (
  rules: FloatingRules,
  before: readonly DomicileWindow[],
  after: readonly DomicileWindow[],
): readonly Action[] => {
  // Keyed once: the host lists every window on every change.
  const was = new Map(before.map((window) => [window.appId, window]));
  const listed = new Set(after.map(({ appId }) => appId));
  return [
    ...after.flatMap((window) =>
      changesOf(rules, was.get(window.appId), window),
    ),
    ...before
      .filter(({ appId }) => !listed.has(appId))
      .map(({ appId }) => WindowAction.AppClosed(appId)),
  ];
};

/** The changes to one window. `was` is `undefined` for a new one. */
const changesOf = (
  rules: FloatingRules,
  was: DomicileWindow | undefined,
  window: DomicileWindow,
): readonly Action[] =>
  window.parent === null
    ? toplevelChanges(rules, was, window)
    : popupChanges(was, window, window.parent);

const toplevelChanges = (
  rules: FloatingRules,
  was: DomicileWindow | undefined,
  window: DomicileWindow,
): readonly Action[] => {
  const { appId } = window;
  const before = was ?? { ...window, ...UNSAID };
  const minSize = limitOf(window.minWidth, window.minHeight);
  const maxSize = limitOf(window.maxWidth, window.maxHeight);
  return [
    ...(was === undefined ? [appeared(rules, window)] : []),
    ...(was !== undefined && before.title !== window.title
      ? [WindowAction.AppTitled(appId, named(window.title))]
      : []),
    ...(sameLimit(limitOf(before.minWidth, before.minHeight), minSize)
      ? []
      : [WindowAction.AppMinSize(appId, minSize)]),
    ...(sameLimit(limitOf(before.maxWidth, before.maxHeight), maxSize)
      ? []
      : [WindowAction.AppMaxSize(appId, maxSize)]),
    ...(before.cursor === window.cursor
      ? []
      : [WindowAction.AppCursorChanged(appId, window.cursor)]),
    ...(before.desktopId === window.desktopId
      ? []
      : [WindowAction.AppDesktopIdChanged(appId, window.desktopId)]),
    ...(before.frame === window.frame
      ? []
      : [WindowAction.AppFrameSynced(appId, window.frame)]),
  ];
};

const popupChanges = (
  was: DomicileWindow | undefined,
  window: DomicileWindow,
  parent: string,
): readonly Action[] =>
  was !== undefined &&
  was.parent === parent &&
  was.x === window.x &&
  was.y === window.y &&
  was.width === window.width &&
  was.height === window.height &&
  was.frame === window.frame
    ? []
    : [WindowAction.PopupPlaced(popupOf(window, parent))];

/** A window's state before its client has sent anything. */
const UNSAID = {
  cursor: "default",
  desktopId: "",
  frame: 0,
  maxHeight: null,
  maxWidth: null,
  minHeight: null,
  minWidth: null,
} as const;

/** The action that opens a new window, tiled or floating. */
const appeared = (rules: FloatingRules, window: DomicileWindow): Action => {
  const { appId, clientFrame, height, title, width } = window;
  if (!opensFloating(rules, window)) {
    return WindowAction.AppAppeared(appId, named(title));
  } else if (width === null || height === null) {
    throw new Error(`windows: ${appId} is listed before it drew`);
  } else {
    return WindowAction.AppAppearedFloating(
      appId,
      named(title),
      [width, height],
      clientFrame,
    );
  }
};

/** A popup's placement. */
const popupOf = (window: DomicileWindow, parent: string): Popup => {
  const { height, width, x, y } = window;
  if (x === null || y === null || width === null || height === null) {
    throw new Error(`shell: popup ${window.appId} is listed with no place`);
  } else {
    return {
      appId: window.appId,
      frame: window.frame,
      parent,
      position: [x, y],
      size: [width, height],
    };
  }
};

const limitOf = (width: number | null, height: number | null): SizeLimit => [
  width ?? undefined,
  height ?? undefined,
];

const sameLimit = (a: SizeLimit, b: SizeLimit): boolean =>
  a[0] === b[0] && a[1] === b[1];

/** A title, or `undefined` for an untitled window. */
const named = (title: string): string | undefined =>
  title === "" ? undefined : title;
