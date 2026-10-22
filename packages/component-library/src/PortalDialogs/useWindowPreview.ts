import type { Result } from "@cprussin/option-result";
import {
  PreviewedWindow,
  PreviewedWindowKind,
} from "@domicile-desktop/sdk/previewed-window";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

/** Draws a window as it last drew itself, as `System.previewWindow` does. */
export type DrawPreview = (
  window: PreviewedWindow,
) => Promise<Result<string, SystemError>>;

/**
 * `window` drawn by `draw`: its frame's `data:` URL, the error that kept it
 * from drawing, or `undefined` while it draws or when there is no window.
 */
export const useWindowPreview = (
  window: PreviewedWindow | undefined,
  draw: DrawPreview,
): Result<string, SystemError> | undefined => {
  const [drawn, setDrawn] = useState<
    { key: string; frame: Result<string, SystemError> } | undefined
  >(undefined);
  // Primitives, so a window rebuilt on each render draws once.
  const kind = window?.kind;
  const id = window?.id;
  useEffect(() => {
    let current = true;
    if (kind !== undefined && id !== undefined) {
      draw(previewed(kind, id))
        .then((frame) => {
          if (current) {
            setDrawn({ frame, key: keyOf(kind, id) });
          }
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: surfacing a failed preview call
          console.error("Failed to draw a window preview", error);
        });
    }
    return () => {
      current = false;
    };
  }, [draw, id, kind]);
  return kind !== undefined &&
    id !== undefined &&
    drawn?.key === keyOf(kind, id)
    ? drawn.frame
    : undefined;
};

/** The window of `kind` and `id`. */
const previewed = (kind: PreviewedWindowKind, id: string): PreviewedWindow => {
  switch (kind) {
    case PreviewedWindowKind.App:
      return PreviewedWindow.App(id);
    case PreviewedWindowKind.Browser:
      return PreviewedWindow.Browser(id);
  }
};

const keyOf = (kind: PreviewedWindowKind, id: string): string =>
  `${String(kind)}:${id}`;
