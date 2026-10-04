import type { DomicileWindow } from "@domicile-desktop/sdk/domicile-host";

import type { Popup } from "./popup";
import type { SizeLimit } from "./window";
import type { WindowAction as Action } from "./window-state";
import { WindowAction } from "./window-state";

/**
 * What the desktop is told of the host's windows moving from `before` to
 * `after`: a window that appeared, each thing its client said of it since,
 * and a window that went — in `after`'s order, closings last.
 *
 * The host lists every window whole after any change, and the desktop's
 * reducer takes them as the moments they were. This is where one becomes the
 * other. A popup is placed rather than announced: it is drawn over its
 * window, not laid out as one.
 */
export const windowChanges = (
  before: readonly DomicileWindow[],
  after: readonly DomicileWindow[],
): readonly Action[] => [
  ...after.flatMap((window) =>
    changesOf(
      before.find(({ appId }) => appId === window.appId),
      window,
    ),
  ),
  ...before
    .filter(({ appId }) => !after.some((window) => window.appId === appId))
    .map(({ appId }) => WindowAction.AppClosed(appId)),
];

/** What changed of one window, which `was` is `undefined` for until listed. */
const changesOf = (
  was: DomicileWindow | undefined,
  window: DomicileWindow,
): readonly Action[] =>
  window.parent === null
    ? toplevelChanges(was, window)
    : popupChanges(was, window, window.parent);

const toplevelChanges = (
  was: DomicileWindow | undefined,
  window: DomicileWindow,
): readonly Action[] => {
  const { appId } = window;
  const before = was ?? { ...window, ...UNSAID };
  const minSize = limitOf(window.minWidth, window.minHeight);
  const maxSize = limitOf(window.maxWidth, window.maxHeight);
  return [
    ...(was === undefined
      ? [WindowAction.AppAppeared(appId, named(window.title))]
      : []),
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
  was.height === window.height
    ? []
    : [WindowAction.PopupPlaced(popupOf(window, parent))];

/** What a window says of itself before its client has said anything. */
const UNSAID = {
  cursor: "default",
  maxHeight: null,
  maxWidth: null,
  minHeight: null,
  minWidth: null,
} as const;

/** A popup's place, which the host gives whole whenever it lists one. */
const popupOf = (window: DomicileWindow, parent: string): Popup => {
  const { height, width, x, y } = window;
  if (x === null || y === null || width === null || height === null) {
    throw new Error(`shell: popup ${window.appId} is listed with no place`);
  } else {
    return {
      appId: window.appId,
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

/** A title, or `undefined` for a window its client has not named. */
const named = (title: string): string | undefined =>
  title === "" ? undefined : title;
