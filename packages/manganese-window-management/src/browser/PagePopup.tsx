import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";

type Props = {
  children: ReactNode;
  /** How long it stays up, in milliseconds, unless the pointer is on it. */
  closesAfter: number;
  /** Counts what it showed; each new one waits `closesAfter` again. */
  cue: number;
  /** Names it for a screen reader, such as "Zoom". */
  label: string;
  /**
   * Asks to close what it showed for `cue`, after its time or on Escape.
   * Ignore a cue that has since moved on.
   */
  onClose: (cue: number) => void;
  open: boolean;
};

/**
 * A popup over a browser window's page saying what just changed, such as its
 * zoom, as Chrome's bubbles do. Closes by itself, but not while the pointer
 * is on it.
 *
 * Drawn in the page's own box, at its top trailing corner, over the
 * `<webview>` and nothing else: never over the desktop or another window.
 * Leaves the keyboard in the page until one of its controls is pressed.
 */
export const PagePopup = ({
  children,
  closesAfter,
  cue,
  label,
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

  return open ? (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds it up while the pointer rests on it, and Escape from one of its controls closes it, as a popover's would
    <div
      aria-label={label}
      className={popupStyles}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose(cue);
        }
      }}
      onPointerEnter={() => {
        setHeld(true);
      }}
      onPointerLeave={() => {
        setHeld(false);
      }}
      role="dialog"
    >
      {children}
    </div>
  ) : undefined;
};

// A popover's card, at the page's top trailing corner, under the address
// bar's zoom control.
const popupStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "lifted",
  color: "foreground",
  insetBlockStart: 2,
  insetInlineEnd: 2,
  maxInlineSize: "calc(100% - {spacing.4})",
  paddingBlock: 3,
  paddingInline: 3.5,
  position: "absolute",
});
