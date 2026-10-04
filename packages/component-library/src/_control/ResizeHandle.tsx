import type { MouseEvent, RefObject } from "react";
import { useEffect, useRef } from "react";

import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";

type Props = {
  disabled: boolean;
  rounded: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

export const ResizeHandle = ({ disabled, rounded, textareaRef }: Props) => {
  // Lets an unmount mid-drag remove the document listeners and restore the
  // body cursor.
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      if (cleanupRef.current !== undefined) {
        cleanupRef.current();
        cleanupRef.current = undefined;
      }
    },
    [],
  );

  return (
    <span
      aria-hidden
      className={handleStyles({ disabled, rounded })}
      data-resize-handle=""
      onMouseDown={(event) => {
        // Clear the ref on mouseup so a later unmount doesn't restore a stale
        // cursor.
        cleanupRef.current = startResize(event, textareaRef.current, () => {
          cleanupRef.current = undefined;
        });
      }}
    >
      <span className={cornerStyles} />
    </span>
  );
};

const cornerStyles = css({
  blockSize: 1.5,
  borderBlockEnd: "1px solid currentColor",
  borderInlineEnd: "1px solid currentColor",
  inlineSize: 1.5,
});

const handleStyles = cva({
  base: {
    ...flex.raw({ align: "flex-end", justify: "flex-end" }),
    _hover: { color: "muted" },
    blockSize: 4,
    color: "border",
    cursor: "ns-resize",
    inlineSize: 4,
    insetBlockEnd: 0.5,
    insetInlineEnd: 0.5,
    padding: 0.5,
    position: "absolute",
    transition: "color {durations.fast} {easings.default}",
  },
  variants: {
    disabled: {
      true: {
        cursor: "not-allowed",
        pointerEvents: "none",
      },
    },
    rounded: {
      true: {
        insetBlockEnd: 1,
        insetInlineEnd: 3,
      },
    },
  },
});

/**
 * Starts a resize drag and returns a cleanup that aborts it.
 *
 * `onComplete` runs when the drag ends on mouseup. Returns `undefined` if the
 * textarea is missing or disabled.
 */
const startResize = (
  event: MouseEvent<HTMLElement>,
  textarea: HTMLTextAreaElement | null,
  onComplete?: () => void,
): (() => void) | undefined => {
  if (textarea === null || textarea.disabled === true) {
    return undefined;
  } else {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = textarea.offsetHeight;
    const computed = globalThis.getComputedStyle(textarea);
    const parsedMin = Number.parseFloat(computed.minBlockSize);
    const minHeight = Number.isNaN(parsedMin) ? 0 : parsedMin;
    const parsedMax = Number.parseFloat(computed.maxBlockSize);
    const maxHeight = Number.isNaN(parsedMax)
      ? Number.POSITIVE_INFINITY
      : parsedMax;
    const previousBodyCursor = document.body.style.cursor;
    document.body.style.cursor = "ns-resize";
    // Keeps the wrapper's hover border while the pointer is outside it.
    textarea.setAttribute("data-resizing", "");
    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      const next = Math.min(
        maxHeight,
        Math.max(minHeight, startHeight + (moveEvent.clientY - startY)),
      );
      textarea.style.blockSize = `${next}px`;
    };
    const finish = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", finish);
      document.body.style.cursor = previousBodyCursor;
      textarea.removeAttribute("data-resizing");
    };
    const cleanup = () => {
      finish();
      onComplete?.();
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", cleanup);
    return cleanup;
  }
};
