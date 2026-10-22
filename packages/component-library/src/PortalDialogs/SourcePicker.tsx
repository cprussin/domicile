import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { FrozenDesk, ShotRect } from "@domicile-desktop/sdk/portal";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { center, flex } from "../../styled-system/patterns";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";

/**
 * Something a picker offers, and how its row shows it: `name` over
 * `detail`. `label` names it to a screen reader. `area` is where the frozen
 * desk shows it, if it does.
 */
export type Choice = {
  area: ShotRect | undefined;
  detail: string | undefined;
  icon: ReactNode;
  label: string;
  name: string;
};

/** A labeled run of a picker's rows; the first section may have no label. */
export type ChoiceSection = {
  choices: readonly Choice[];
  label: string | undefined;
};

/** An area of the desk to outline with its size, keyed by its pick. */
type Outline = { area: ShotRect; key: string };

type Props = {
  /** What the list picks, for a screen reader. */
  label: string;
  /** Under the desk: what the pick is, or how to pick. */
  caption: string;
  desk: FrozenDesk | undefined;
  multiple: boolean;
  /** An area dragged over the desk, outlined in place of the picks. */
  dragged?: ShotRect | undefined;
  /** Called with a dragged area; without it, the desk cannot be dragged. */
  onDrag?: ((area: ShotRect) => void) | undefined;
  onPick: (picked: number[]) => void;
  /** The indexes, across every section, of the choices picked. */
  picked: readonly number[];
  sections: readonly ChoiceSection[];
};

/**
 * Picks from a list of sources beside one preview of the frozen desk, which
 * outlines each pick with its size. One source is a radio, several are
 * checkboxes. The screenshot and screen cast pickers share it.
 */
export const SourcePicker = ({
  caption,
  desk,
  dragged,
  label,
  multiple,
  onDrag,
  onPick,
  picked,
  sections,
}: Props) => {
  const rows = numbered(sections, multiple);
  const choices = sections.flatMap((section) => section.choices);
  const outlined: Outline[] =
    dragged === undefined
      ? picked.flatMap((index) => {
          const area = choices[index]?.area;
          return area === undefined ? [] : [{ area, key: String(index) }];
        })
      : [{ area: dragged, key: "dragged" }];
  return (
    <div className={layoutStyles}>
      {multiple ? (
        <CheckboxGroup
          aria-label={label}
          className={listStyles}
          onValueChange={(value) => {
            onPick(value.map(Number));
          }}
          value={picked.map(String)}
        >
          {rows}
        </CheckboxGroup>
      ) : (
        // `null` is Base UI's "no radio checked".
        <RadioGroup<number | null>
          aria-label={label}
          className={listStyles}
          onValueChange={(value) => {
            if (value === null) {
              throw new Error("a radio unchecked the picker's choices");
            } else {
              onPick([value]);
            }
          }}
          value={picked[0] ?? null}
        >
          {rows}
        </RadioGroup>
      )}
      <figure className={stageStyles}>
        {desk === undefined ? (
          <span className={noDeskStyles}>No preview</span>
        ) : (
          <Desk desk={desk} onDrag={onDrag} outlined={outlined} />
        )}
        <figcaption className={captionStyles}>{caption}</figcaption>
      </figure>
    </div>
  );
};

/** Each section's rows, numbered across the sections. */
const numbered = (
  sections: readonly ChoiceSection[],
  multiple: boolean,
): ReactNode[] =>
  sections.map((section, at) => {
    const first = sections
      .slice(0, at)
      .reduce((count, { choices }) => count + choices.length, 0);
    const rows = section.choices.map((choice, offset) => (
      // Keyed by index: names repeat, as two untitled windows do, and the
      // order is fixed.
      <Row
        choice={choice}
        index={first + offset}
        key={first + offset}
        multiple={multiple}
      />
    ));
    return section.label === undefined
      ? rows
      : section.choices.length > 0 && (
          <div
            aria-label={section.label}
            className={sectionStyles}
            key={section.label}
            role="group"
          >
            <span aria-hidden className={sectionLabelStyles}>
              {section.label}
            </span>
            {rows}
          </div>
        );
  });

/** `choice`'s row, picking it as choice `index`. */
const Row = ({
  choice,
  index,
  multiple,
}: {
  choice: Choice;
  index: number;
  multiple: boolean;
}) => {
  const content = (
    <>
      {choice.icon}
      <span className={rowTextStyles}>
        <span className={rowNameStyles}>{choice.name}</span>
        {choice.detail !== undefined && (
          <span className={rowDetailStyles}>{choice.detail}</span>
        )}
      </span>
    </>
  );
  return multiple ? (
    <Checkbox.Root
      aria-label={choice.label}
      className={rowStyles}
      value={String(index)}
    >
      {content}
    </Checkbox.Root>
  ) : (
    <Radio.Root aria-label={choice.label} className={rowStyles} value={index}>
      {content}
    </Radio.Root>
  );
};

/** The frozen desk, outlining `outlined`, and dragged when `onDrag` is set. */
const Desk = ({
  desk,
  onDrag,
  outlined,
}: {
  desk: FrozenDesk;
  onDrag: ((area: ShotRect) => void) | undefined;
  outlined: readonly Outline[];
}) => {
  const [dragFrom, setDragFrom] = useState<FramePoint | undefined>(undefined);
  const pointAt = (event: PointerEvent<HTMLDivElement>) =>
    framePoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      desk,
    );
  const frame = (
    <>
      <img
        alt="The desk"
        className={frameStyles}
        draggable={false}
        src={desk.frame}
      />
      {outlined.map(({ area, key }) => (
        <div
          className={pickedStyles}
          // One pick shades the rest of the desk; several would shade each
          // other.
          data-shaded={outlined.length === 1 ? "" : undefined}
          key={key}
          style={placed(area, desk)}
        >
          <span className={sizeStyles}>
            {`${String(area.width)} × ${String(area.height)}`}
          </span>
        </div>
      ))}
    </>
  );
  return onDrag === undefined ? (
    <div className={deskStyles} style={fitted(desk)}>
      {frame}
    </div>
  ) : (
    <div
      aria-label="Drag to pick an area"
      className={deskStyles}
      data-draggable=""
      onPointerDown={(event) => {
        const from = pointAt(event);
        setDragFrom(from);
        onDrag(draggedArea(from, from));
      }}
      onPointerMove={(event) => {
        if (dragFrom !== undefined) {
          onDrag(draggedArea(dragFrom, pointAt(event)));
        }
      }}
      onPointerUp={() => {
        setDragFrom(undefined);
      }}
      role="group"
      style={fitted(desk)}
    >
      {frame}
    </div>
  );
};

const layoutStyles = css({
  alignItems: "stretch",
  display: "grid",
  gap: 4,
  gridTemplateColumns: "{spacing.64} minmax(0, 1fr)",
});

// As tall as the desk beside it, scrolling when the rows run longer: a zero
// height keeps the rows out of the grid row's height.
const listStyles = flex({
  blockSize: 0,
  direction: "column",
  gap: 3,
  minBlockSize: "full",
  overflowY: "auto",
  // Room for the focus ring, which the scrolling would clip.
  padding: 1,
});

const sectionStyles = flex({ direction: "column", gap: 0.5 });

const sectionLabelStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "medium",
  letterSpacing: "wide",
  paddingBlockEnd: 1,
  paddingInline: 2.5,
  textTransform: "uppercase",
});

const rowStyles = css({
  _checked: {
    backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
    borderColor: "accent",
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 6%, transparent)",
  },
  "& > :is(svg, img)": {
    blockSize: 5,
    color: "muted",
    flexShrink: 0,
    inlineSize: 5,
  },
  alignItems: "center",
  backgroundColor: "transparent",
  border: "1px solid transparent",
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  display: "flex",
  flexShrink: 0,
  font: "inherit",
  gap: 2.5,
  minInlineSize: 0,
  paddingBlock: 1.5,
  paddingInline: 2.5,
  textAlign: "start",
  transition: "background-color {durations.fast} {easings.out}",
});

const rowTextStyles = flex({ direction: "column", minInlineSize: 0 });

const rowNameStyles = css({
  fontSize: "sm",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const rowDetailStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const stageStyles = flex({
  align: "center",
  backgroundColor: "background",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  direction: "column",
  gap: 3,
  justify: "center",
  margin: 0,
  minBlockSize: 72,
  padding: 4,
});

const noDeskStyles = css({ color: "muted", fontSize: "sm" });

const deskStyles = css({
  "&[data-draggable]": { cursor: "crosshair" },
  borderRadius: "sm",
  // Keeps the shade around the picked area on the frame.
  overflow: "hidden",
  position: "relative",
  touchAction: "none",
  userSelect: "none",
});

const frameStyles = css({
  blockSize: "full",
  display: "block",
  inlineSize: "full",
});

const pickedStyles = css({
  "&[data-shaded]": { boxShadow: "0 0 0 100vmax {colors.backdrop}" },
  border: "2px solid {colors.accent}",
  pointerEvents: "none",
  position: "absolute",
});

const sizeStyles = center({
  backgroundColor: "accent",
  borderEndEndRadius: "sm",
  color: "background",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "medium",
  insetBlockStart: 0,
  insetInlineStart: 0,
  paddingBlock: 0.5,
  paddingInline: 1.5,
  position: "absolute",
  whiteSpace: "nowrap",
});

const captionStyles = css({ color: "muted", fontSize: "xs" });

/**
 * The desk's box in the stage: as wide as the stage allows, at the frame's
 * aspect ratio, no taller than 56% of the screen so the dialog fits on it.
 */
const fitted = (frame: { width: number; height: number }): CSSProperties => {
  const ratio = `${String(frame.width)} / ${String(frame.height)}`;
  return {
    aspectRatio: ratio,
    inlineSize: `min(100%, calc(56cqh * ${ratio}))`,
  };
};

/** `area`'s place over the drawn frame, in percent of `frame`. */
const placed = (
  area: ShotRect,
  frame: { width: number; height: number },
): { left: string; top: string; width: string; height: string } => ({
  height: `${String((area.height / frame.height) * 100)}%`,
  left: `${String((area.x / frame.width) * 100)}%`,
  top: `${String((area.y / frame.height) * 100)}%`,
  width: `${String((area.width / frame.width) * 100)}%`,
});
