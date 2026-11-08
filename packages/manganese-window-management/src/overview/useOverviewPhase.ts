import { useCallback, useState } from "react";

/** Whether the overview is open, or closing after it was. */
export type OverviewPhase = "closing" | "open";

/**
 * The overview's phase, given whether the desk has it `open`. Once it shuts,
 * it is closing until `closed` says its closing has played out, so windows
 * ease back from their tiles.
 */
export const useOverviewPhase = (
  open: boolean,
): { closed: () => void; phase: OverviewPhase | undefined } => {
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open);
  }
  const closed = useCallback(() => {
    setClosing(false);
  }, []);
  return { closed, phase: phaseOf(open, closing) };
};

const phaseOf = (
  open: boolean,
  closing: boolean,
): OverviewPhase | undefined => {
  if (open) {
    return "open";
  } else {
    return closing ? "closing" : undefined;
  }
};
