import { Popover } from "@domicile-desktop/component-library/Popover";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Props = {
  /** What it hangs from: a control in the address bar, or the page's corner. */
  anchor: HTMLElement | null;
  children: ReactNode;
  /** How long it stays up, in milliseconds, unless the pointer is on it. */
  closesAfter: number;
  /** Counts what it showed; each new one waits `closesAfter` again. */
  cue: number;
  /**
   * Asks to close what it showed for `cue`, after its time or on an outside
   * press or Escape. Ignore a cue that has since moved on.
   */
  onClose: (cue: number) => void;
  open: boolean;
};

/**
 * A popup over a browser window's page saying what just changed, such as its
 * zoom or a finished download, as Chrome's bubbles do. Opens without taking
 * the keyboard from the page and closes by itself, but not while the pointer
 * is on it.
 */
export const PagePopup = ({
  anchor,
  children,
  closesAfter,
  cue,
  onClose,
  open,
}: Props) => {
  const [held, setHeld] = useState(false);
  // A popup closed under the pointer never hears it leave.
  if (!open && held) {
    setHeld(false);
  }

  useEffect(() => {
    if (!open || held) {
      return undefined;
    } else {
      const timer = setTimeout(() => {
        onClose(cue);
      }, closesAfter);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [closesAfter, cue, held, onClose, open]);

  return (
    <Popover
      align="end"
      anchor={anchor}
      onOpenChange={(next) => {
        if (!next) {
          onClose(cue);
        }
      }}
      open={open}
      quiet
    >
      <div
        onPointerEnter={() => {
          setHeld(true);
        }}
        onPointerLeave={() => {
          setHeld(false);
        }}
      >
        {children}
      </div>
    </Popover>
  );
};
