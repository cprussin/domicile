import { useRef } from "react";

import { css } from "../../styled-system/css";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import type { Settler } from "../useSettling";
import { useSettling } from "../useSettling";
import { originOf, placedAt, scaledAbout } from "../window-styles";

type Props = {
  /** Where the dragged window would land if dropped now. */
  rect: Rect;
  /** Eases the indicator into a new box; see `useSettling`. */
  settler?: Settler | undefined;
};

/**
 * Shows where a dragged tiled window would land, like sway's drop indicator.
 *
 * Nothing retiles until the drop, so this is the only preview. It is drawn
 * after every window at the tiling's depth and ignores the pointer. It takes
 * each new aim's box at once and settles into it.
 */
export const DropIndicator = ({ rect, settler }: Props) => {
  const element = useRef<HTMLDivElement>(null);
  useSettling({
    element,
    origin: originOf(rect, rect),
    rect,
    settler,
    still: false,
  });
  return (
    <div
      className={indicatorStyles}
      data-drop
      ref={element}
      style={{ ...placedAt(rect, TILED), ...scaledAbout(rect, rect) }}
    />
  );
};

const indicatorStyles = css({
  background: "color-mix(in oklab, {colors.accent} 30%, transparent)",
  border: "{spacing.0.5} solid {colors.accent}",
  borderRadius: "lg",
  pointerEvents: "none",
});
