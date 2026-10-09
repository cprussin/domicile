/** A rectangle of the page, in its CSS pixels. */
export type PageBox = { x: number; y: number; width: number; height: number };

/** The kind of a {@link ShownWindow}. */
export enum ShownWindowKind {
  App,
  Browser,
}

/**
 * A window the shell draws on screen, and its whole frame there: title bar,
 * address bar or tab strip included. The screenshot dialog crops a shown
 * window from the frozen desk by this box.
 */
export const ShownWindow = {
  /** An `<app>`'s window, by host app id. */
  App: (appId: string, box: PageBox) => ({
    appId,
    box,
    kind: ShownWindowKind.App as const,
  }),
  /** A browser window, by the engine's id. */
  Browser: (id: string, box: PageBox) => ({
    box,
    id,
    kind: ShownWindowKind.Browser as const,
  }),
};

export type ShownWindow = ReturnType<
  (typeof ShownWindow)[keyof typeof ShownWindow]
>;

/**
 * The windows `page` draws: each `<app>` and each `<webview window>` with a
 * box. Their boxes leave out the shell's frame, and a window hidden under
 * another still has one; a shell that knows better passes its own list.
 */
export const drawnWindows = (page: ParentNode): ShownWindow[] => [
  ...[...page.querySelectorAll("app[app-id]")].flatMap((app) =>
    drawn(app, (box) => ShownWindow.App(attribute(app, "app-id"), box)),
  ),
  ...[...page.querySelectorAll("webview[window]")].flatMap((view) =>
    drawn(view, (box) => ShownWindow.Browser(attribute(view, "window"), box)),
  ),
];

/** `element` as `shown` makes it, unless it has no box. */
const drawn = (
  element: Element,
  shown: (box: PageBox) => ShownWindow,
): ShownWindow[] => {
  const { height, width, x, y } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? [shown({ height, width, x, y })] : [];
};

/** `element`'s `name` attribute, which its selector guarantees. */
const attribute = (element: Element, name: string): string => {
  const value = element.getAttribute(name);
  if (value === null) {
    throw new Error(`a selected element has no ${name}`);
  } else {
    return value;
  }
};
