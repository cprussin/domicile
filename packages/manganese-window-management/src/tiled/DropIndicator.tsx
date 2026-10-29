import { useRef, useState } from "react";

import { cva } from "../../styled-system/css";
import { raised, TILED } from "../placement";
import type { Rect } from "../rect";
import { sameRect } from "../rect";
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
 *
 * The box never settles into the line: scaled up from the line's box, its
 * border and rounding would draw a blob. For a line, the box fades out where
 * it was and the line fades in. Leaving a line, the box grows out of it.
 */
export const DropIndicator = ({ aim, settler }: Props) => {
  const line = aim.kind === AimKind.Tab;
  // The last box aimed at, for the line to fade it out where it was.
  const [box, setBox] = useState(line ? undefined : aim.rect);
  if (!line && (box === undefined || !sameRect(box, aim.rect))) {
    setBox(aim.rect);
  }
  return line ? (
    <>
      {box !== undefined && (
        <Part
          depth={raised(aim.depth)}
          key="fading"
          name="fading"
          rect={box}
          settler={settler}
        />
      )}
      <Part
        depth={raised(aim.depth)}
        key="line"
        name="line"
        rect={aim.rect}
        settler={settler}
      />
    </>
  ) : (
    <Part
      depth={raised(TILED)}
      key="box"
      name="box"
      rect={aim.rect}
      settler={settler}
    />
  );
};

type PartProps = {
  depth: number;
  name: "box" | "fading" | "line";
  rect: Rect;
  settler: Settler | undefined;
};

/** The line hands its place to the box that replaces it, never the reverse. */
const LINE = ["drop-line"];

/** One part of the indicator, settling into each new `rect`. */
const Part = ({ depth, name, rect, settler }: PartProps) => {
  const element = useRef<HTMLDivElement>(null);
  useSettling({
    element,
    origin: originOf(rect, rect),
    rect,
    settler,
    shared: name === "line" ? LINE : undefined,
    still: false,
    takesOver: name === "box" ? LINE : undefined,
  });
  return (
    <div
      className={partStyles({ name })}
      data-drop={name}
      ref={element}
      style={{ ...placedAt(rect, depth), ...scaledAbout(rect, rect) }}
    />
  );
};

const partStyles = cva({
  base: { pointerEvents: "none" },
  variants: {
    name: {
      box: {
        background: "color-mix(in oklab, {colors.accent} 30%, transparent)",
        border: "{spacing.0.5} solid {colors.accent}",
        borderRadius: "lg",
      },
      // The box, fading out where it was.
      fading: {
        animation: "dropBoxFading {durations.fast} {easings.out} forwards",
        background: "color-mix(in oklab, {colors.accent} 30%, transparent)",
        border: "{spacing.0.5} solid {colors.accent}",
        borderRadius: "lg",
      },
      line: {
        animation: "dropLineShowing {durations.fast} {easings.out}",
        background: "accent",
        borderRadius: "full",
      },
    },
  },
});
