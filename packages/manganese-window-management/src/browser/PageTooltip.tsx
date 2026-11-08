import { useLayoutEffect, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { usePageTooltip } from "../usePageTooltip";

type Props = {
  /**
   * The page whose tooltip it shows. Read here, so a tooltip redraws only
   * itself.
   */
  view: HTMLWebViewElement | null;
};

/** How far below the pointer it sits, clear of the cursor, in CSS pixels. */
export const BELOW_POINTER = 20;

/**
 * Shows the page's tooltip, such as a `title`, below the pointer and inside
 * the page, styled like the component library's `Tooltip`. The engine draws
 * none; see `tooltip` on `<webview>`.
 */
export const PageTooltip = ({ view }: Props) => {
  const { text, x, y } = usePageTooltip(view);
  const ref = useRef<HTMLDivElement>(null);
  // Kept inside the page: moved left at its right edge, and above the
  // pointer at its bottom.
  const [place, setPlace] = useState({ left: x, top: y + BELOW_POINTER });

  useLayoutEffect(() => {
    const tip = ref.current;
    const page = tip?.offsetParent;
    // Measured again for each text, since the tip's size follows it.
    if (text === "" || tip === null || !(page instanceof HTMLElement)) {
      setPlace({ left: x, top: y + BELOW_POINTER });
    } else {
      const below = y + BELOW_POINTER;
      setPlace({
        left: Math.max(0, Math.min(x, page.clientWidth - tip.offsetWidth)),
        top:
          below + tip.offsetHeight > page.clientHeight
            ? Math.max(0, y - tip.offsetHeight - 4)
            : below,
      });
    }
  }, [text, x, y]);

  return text === "" ? undefined : (
    <div
      className={tooltipStyles}
      ref={ref}
      role="tooltip"
      style={{ insetBlockStart: place.top, insetInlineStart: place.left }}
    >
      {text}
    </div>
  );
};

// As the component library's `Tooltip`. Ignores the pointer so it never
// blocks the page; keeps the page's line breaks, as Chrome does.
const tooltipStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  color: "foreground",
  fontSize: "xs",
  lineHeight: "normal",
  maxInlineSize: "min({spacing.88}, 90%)",
  overflowWrap: "anywhere",
  paddingBlock: 1.5,
  paddingInline: 2.5,
  pointerEvents: "none",
  position: "absolute",
  whiteSpace: "pre-line",
});
