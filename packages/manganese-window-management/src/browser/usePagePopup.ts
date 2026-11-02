import { useCallback, useState } from "react";

/** Which popup a browser window shows over its page. */
export enum PagePopupKind {
  Downloads,
  Zoom,
}

type Shown = {
  /** Counts each showing, so a popup shown again restarts its time. */
  cue: number;
  /** `undefined` while none shows. */
  kind: PagePopupKind | undefined;
};

/**
 * The one popup a browser window shows over its page: its zoom, or its
 * finished downloads, as Chrome's bubbles do. A new one replaces the one
 * showing; a closed one never comes back by itself.
 *
 * Shows the downloads each time `completed`, the count of finished downloads,
 * goes up while `inView`: the window is focused and no tab covers it. Closes
 * when the window goes out of view, so it never sits over another window.
 */
export const usePagePopup = (
  completed: number,
  inView: boolean,
): Shown & {
  /** Closes the popup shown for `cue`, unless another has replaced it. */
  close: (cue: number) => void;
  show: (kind: PagePopupKind) => void;
} => {
  const [shown, setShown] = useState<Shown>({ cue: 0, kind: undefined });
  const [lastCompleted, setLastCompleted] = useState(completed);
  const [wasInView, setWasInView] = useState(inView);

  // Adjusts state during render rather than in an effect, so the popup shows
  // in the same render as the download.
  if (completed !== lastCompleted) {
    setLastCompleted(completed);
    if (completed > lastCompleted && inView) {
      setShown({ cue: shown.cue + 1, kind: PagePopupKind.Downloads });
    }
  }
  if (inView !== wasInView) {
    setWasInView(inView);
    if (!inView) {
      setShown({ cue: shown.cue + 1, kind: undefined });
    }
  }

  const show = useCallback((kind: PagePopupKind) => {
    setShown((current) => ({ cue: current.cue + 1, kind }));
  }, []);
  const close = useCallback((cue: number) => {
    setShown((current) =>
      current.cue === cue ? { cue, kind: undefined } : current,
    );
  }, []);

  return { ...shown, close, show };
};
