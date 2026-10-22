// A window `System.previewWindow` draws for a picker.

export enum PreviewedWindowKind {
  App,
  Browser,
}

export const PreviewedWindow = {
  /** A client's window, by host app id. */
  App: (id: string) => ({ id, kind: PreviewedWindowKind.App as const }),
  /** A browser window's page, by the engine's window id. */
  Browser: (id: string) => ({ id, kind: PreviewedWindowKind.Browser as const }),
};

export type PreviewedWindow = ReturnType<
  (typeof PreviewedWindow)[keyof typeof PreviewedWindow]
>;
