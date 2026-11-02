import type { Download } from "@domicile-desktop/sdk/desktop/downloads";
import { DownloadState } from "@domicile-desktop/sdk/desktop/downloads";
import { useEffect, useState } from "react";

/** What the bar item shows. */
export enum ItemPhase {
  /** How far the downloads in progress have come. */
  Running,
  /** The last one in progress finished: 100%, briefly. */
  Full,
  /** Then that it is done, briefly. */
  Done,
  /** Just its icon. */
  Resting,
}

/** How long it shows 100% once the last download finishes. */
export const FULL_MS = 400;
/** How long it then says it is done. */
export const DONE_MS = 2000;

/** The phase `phase` gives way to by itself, and after how long. */
const nextOf = (
  phase: ItemPhase,
): { after: number; phase: ItemPhase } | undefined => {
  switch (phase) {
    case ItemPhase.Full: {
      return { after: FULL_MS, phase: ItemPhase.Done };
    }
    case ItemPhase.Done: {
      return { after: DONE_MS, phase: ItemPhase.Resting };
    }
    case ItemPhase.Running:
    case ItemPhase.Resting: {
      return undefined;
    }
  }
};

/**
 * What the bar item shows for `downloads`: running while any is in progress,
 * and resting otherwise. As the last in progress finishes, it shows 100%,
 * then done, then rests; one canceled or failed rests at once.
 */
export const useFinish = (
  downloads: readonly Download[] | undefined,
): ItemPhase => {
  const running = (downloads ?? [])
    .filter(({ state }) => state === DownloadState.InProgress)
    .map(({ id }) => id);
  const [seen, setSeen] = useState<{
    phase: ItemPhase;
    running: readonly string[];
  }>({
    phase: running.length > 0 ? ItemPhase.Running : ItemPhase.Resting,
    running,
  });

  // Worked out while rendering, so the item never shows a frame of rest
  // between the last percent and 100%.
  const changed =
    running.length !== seen.running.length ||
    running.some((id, index) => id !== seen.running[index]);
  let phase = seen.phase;
  if (changed) {
    if (running.length > 0) {
      phase = ItemPhase.Running;
    } else if (
      seen.running.length > 0 &&
      (downloads ?? []).some(
        ({ id, state }) =>
          state === DownloadState.Complete && seen.running.includes(id),
      )
    ) {
      phase = ItemPhase.Full;
    } else if (phase === ItemPhase.Running) {
      phase = ItemPhase.Resting;
    }
    setSeen({ phase, running });
  }

  useEffect(() => {
    const next = nextOf(phase);
    if (next === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setSeen((current) =>
        current.phase === phase ? { ...current, phase: next.phase } : current,
      );
    }, next.after);
    return () => {
      clearTimeout(timer);
    };
  }, [phase]);

  return phase;
};
