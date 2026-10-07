import type { PointerEvent } from "react";
import { useEffect, useState } from "react";
import { css } from "../../styled-system/css";

type Pair = readonly [number, number];

type Props = {
  /** The rectangle dragged, in page pixels: the desktop's logical pixels. */
  pick: (position: Pair, size: Pair) => void;
  /** Escape was pressed. */
  cancel: () => void;
};

/**
 * Covers the whole page, which spans the desk, and lets the user drag a
 * rectangle on it. A click that drags nothing picks nothing.
 */
export const RegionPicker = ({ cancel, pick }: Props) => {
  const [from, setFrom] = useState<Pair | undefined>(undefined);
  const [to, setTo] = useState<Pair | undefined>(undefined);

  useEffect(() => {
    const goBack = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
      }
    };
    document.addEventListener("keydown", goBack);
    return () => {
      document.removeEventListener("keydown", goBack);
    };
  }, [cancel]);

  const drawn =
    from === undefined || to === undefined ? undefined : rectangle(from, to);
  return (
    <div
      aria-label="Drag to pick a region to share"
      className={deskStyles}
      onPointerDown={(event) => {
        setFrom(pointAt(event));
        setTo(pointAt(event));
      }}
      onPointerMove={(event) => {
        if (from !== undefined) {
          setTo(pointAt(event));
        }
      }}
      onPointerUp={(event) => {
        if (from !== undefined) {
          const [position, size] = rectangle(from, pointAt(event));
          setFrom(undefined);
          setTo(undefined);
          if (size[0] > 0 && size[1] > 0) {
            pick(position, size);
          }
        }
      }}
      role="application"
    >
      <p className={hintStyles}>
        Drag to pick a region to share. Escape goes back.
      </p>
      {drawn === undefined ? undefined : (
        <div
          className={rectangleStyles}
          style={{
            height: `${String(drawn[1][1])}px`,
            left: `${String(drawn[0][0])}px`,
            top: `${String(drawn[0][1])}px`,
            width: `${String(drawn[1][0])}px`,
          }}
        />
      )}
    </div>
  );
};

const deskStyles = css({
  backgroundColor: "color-mix(in oklab, black 30%, transparent)",
  cursor: "crosshair",
  inset: 0,
  position: "fixed",
  touchAction: "none",
  userSelect: "none",
  zIndex: "modal",
});

const hintStyles = css({
  backgroundColor: "card",
  borderRadius: "full",
  color: "foreground",
  fontSize: "sm",
  insetBlockStart: 4,
  insetInline: 0,
  margin: 0,
  marginInline: "auto",
  paddingBlock: 1,
  paddingInline: 4,
  pointerEvents: "none",
  position: "absolute",
  width: "fit-content",
});

const rectangleStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.accent} 15%, transparent)",
  border: "2px solid {colors.accent}",
  pointerEvents: "none",
  position: "absolute",
});

/** Where `event` is on the page, in whole pixels. */
const pointAt = (event: PointerEvent): Pair => [
  Math.round(event.clientX),
  Math.round(event.clientY),
];

/** The rectangle with corners `a` and `b`, as its position and size. */
const rectangle = (a: Pair, b: Pair): [Pair, Pair] => [
  [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])],
];
