import { useRef } from "react";

import { cva } from "../../styled-system/css";
import { raised, TILED } from "../placement";
import type { Settler } from "../useSettling";
import { useSettling } from "../useSettling";
import { originOf, placedAt, scaledAbout } from "../window-styles";
import type { Aim } from "./aim";
import { AimKind } from "./aim";

type Props = {
  /** Where the dragged window would land if dropped now. */
  aim: Aim;
  /** Eases the indicator into a new box; see `useSettling`. */
  settler?: Settler | undefined;
};

/**
 * Shows where a dragged tiled window would land, like sway's drop indicator: a
 * box, or a line between two tabs for a new tab.
 *
 * Nothing retiles until the drop, so this is the only preview. It is drawn
 * after every window, over the open tabs at its target's depth, and ignores
 * the pointer. It takes each new aim's box at once and settles into it.
 */
export const DropIndicator = ({ aim, settler }: Props) => {
  const element = useRef<HTMLDivElement>(null);
  const { rect } = aim;
  useSettling({
    element,
    origin: originOf(rect, rect),
    rect,
    settler,
    still: false,
  });
  return (
    <div
      className={indicatorStyles({ line: aim.kind === AimKind.Tab })}
      data-drop
      ref={element}
      style={{
        ...placedAt(rect, raised(aim.kind === AimKind.Tab ? aim.depth : TILED)),
        ...scaledAbout(rect, rect),
      }}
    />
  );
};

const indicatorStyles = cva({
  base: { pointerEvents: "none" },
  variants: {
    line: {
      false: {
        background: "color-mix(in oklab, {colors.accent} 30%, transparent)",
        border: "{spacing.0.5} solid {colors.accent}",
        borderRadius: "lg",
      },
      true: { background: "accent", borderRadius: "full" },
    },
  },
});
