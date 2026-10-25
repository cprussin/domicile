import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { Result } from "@cprussin/option-result";
import type { FrozenDesk, ShotRect } from "@domicile-desktop/sdk/portal";
import type { PreviewedWindow } from "@domicile-desktop/sdk/previewed-window";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { center, flex } from "../../styled-system/patterns";
import { CheckboxRow, RadioRow } from "../ChoiceRow/ChoiceRow";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";
import type { DrawPreview } from "./useWindowPreview";
import { useWindowPreview } from "./useWindowPreview";

/**
 * Something a picker offers, and how its row shows it: `name` over
 * `detail`. `label` names it to a screen reader. `area` is where the frozen
 * desk shows it, if it does; `preview` is the window to draw when it does
 * not.
 */
export type Choice = {
  area: ShotRect | undefined;
  preview: PreviewedWindow | undefined;
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
  /**
   * A part dragged over a window drawn alone, in its frame's pixels, outlined
   * on it.
   */
  draggedPart?: ShotRect | undefined;
  /** Called with a part dragged over a window drawn alone. */
  onDragPart?: ((area: ShotRect) => void) | undefined;
  onPick: (picked: number[]) => void;
  /** The indexes, across every section, of the choices picked. */
  picked: readonly number[];
  /** Draws a window the desk does not show. */
  previewWindow: DrawPreview;
  sections: readonly ChoiceSection[];
};

/**
 * Picks from a list of sources beside one preview of the frozen desk, which
 * outlines each pick with its size. A window picked last that the desk does
 * not show is drawn alone instead, and a part of it may be dragged over it.
 * One source is a radio, several are checkboxes. The screenshot and screen
 * cast pickers share it.
 */
export const SourcePicker = ({
  caption,
  desk,
  dragged,
  draggedPart,
  label,
  multiple,
  onDrag,
  onDragPart,
  onPick,
  picked,
  previewWindow,
  sections,
}: Props) => {
  const rows = numbered(sections, multiple);
  const choices = sections.flatMap((section) => section.choices);
  const last = dragged === undefined ? lastOf(choices, picked) : undefined;
  const hidden = last?.area === undefined ? last : undefined;
  const frame = useWindowPreview(hidden?.preview, previewWindow);
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
        <Stage
          desk={desk}
          draggedPart={draggedPart}
          frame={frame}
          hidden={hidden}
          onDrag={onDrag}
          onDragPart={onDragPart}
          outlined={outlined}
        />
        <figcaption className={captionStyles}>{caption}</figcaption>
      </figure>
    </div>
  );
};

/**
 * What the stage shows: `hidden` drawn alone as `frame` once it draws, else
 * the desk.
 */
const Stage = ({
  desk,
  draggedPart,
  frame,
  hidden,
  onDrag,
  onDragPart,
  outlined,
}: {
  desk: FrozenDesk | undefined;
  draggedPart: ShotRect | undefined;
  frame: Result<string, SystemError> | undefined;
  hidden: Choice | undefined;
  onDrag: ((area: ShotRect) => void) | undefined;
  onDragPart: ((area: ShotRect) => void) | undefined;
  outlined: readonly Outline[];
}) => {
  if (hidden?.preview !== undefined) {
    const preview =
      frame === undefined ? (
        <span className={noDeskStyles}>Drawing a preview…</span>
      ) : (
        frame.match({
          Err: () => <span className={noDeskStyles}>No preview</span>,
          Ok: (src) => (
            <Preview
              alt={hidden.label}
              box={desk}
              dragged={draggedPart}
              // Keyed so a part outlined on one window is not kept on the next.
              key={src}
              onDrag={onDragPart}
              src={src}
            />
          ),
        })
      );
    // In the desk's box, so a pick of another shape keeps the dialog's size.
    return desk === undefined ? (
      preview
    ) : (
      <div className={previewBoxStyles} style={fitted(desk)}>
        {preview}
      </div>
    );
  } else if (desk === undefined) {
    return <span className={noDeskStyles}>No preview</span>;
  } else {
    return <Desk desk={desk} onDrag={onDrag} outlined={outlined} />;
  }
};

/** The choice picked last, if any is. */
const lastOf = (
  choices: readonly Choice[],
  picked: readonly number[],
): Choice | undefined => {
  const index = picked.at(-1);
  return index === undefined ? undefined : choices[index];
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
}) =>
  multiple ? (
    <CheckboxRow
      aria-label={choice.label}
      detail={choice.detail}
      icon={choice.icon}
      name={choice.name}
      value={String(index)}
    />
  ) : (
    <RadioRow
      aria-label={choice.label}
      detail={choice.detail}
      icon={choice.icon}
      name={choice.name}
      value={index}
    />
  );

/**
 * A window drawn alone from `src`, fitted in `box`. With `onDrag`, a part of
 * it may be dragged, in its frame's pixels, and `dragged` is outlined.
 */
const Preview = ({
  alt,
  box,
  dragged,
  onDrag,
  src,
}: {
  alt: string;
  box: { width: number; height: number } | undefined;
  dragged: ShotRect | undefined;
  onDrag: ((area: ShotRect) => void) | undefined;
  src: string;
}) => {
  // The frame's size, which the drag is in, once it loads.
  const [frame, setFrame] = useState<
    { width: number; height: number } | undefined
  >(undefined);
  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: reads the frame's size as it loads, which is no interaction */}
      <img
        alt={alt}
        className={previewStyles}
        draggable={false}
        onLoad={(event) => {
          setFrame({
            height: event.currentTarget.naturalHeight,
            width: event.currentTarget.naturalWidth,
          });
        }}
        src={src}
      />
      {frame !== undefined && box !== undefined && onDrag !== undefined && (
        <Dragged
          frame={frame}
          label="Drag to pick a part of the window"
          onDrag={onDrag}
          outlined={
            dragged === undefined ? [] : [{ area: dragged, key: "dragged" }]
          }
          style={{ ...contained(frame, box), position: "absolute" }}
        />
      )}
    </>
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
  const image = (
    <img
      alt="The desk"
      className={frameStyles}
      draggable={false}
      src={desk.frame}
    />
  );
  return onDrag === undefined ? (
    <div className={deskStyles} style={fitted(desk)}>
      {image}
      <Outlines frame={desk} outlined={outlined} />
    </div>
  ) : (
    <Dragged
      frame={desk}
      label="Drag to pick an area"
      onDrag={onDrag}
      outlined={outlined}
      style={fitted(desk)}
    >
      {image}
    </Dragged>
  );
};

/**
 * A box over a frame of `frame`'s size that an area is dragged on, in the
 * frame's pixels, outlining `outlined`.
 */
const Dragged = ({
  children,
  frame,
  label,
  onDrag,
  outlined,
  style,
}: {
  children?: ReactNode;
  frame: { width: number; height: number };
  label: string;
  onDrag: (area: ShotRect) => void;
  outlined: readonly Outline[];
  style: CSSProperties;
}) => {
  const [dragFrom, setDragFrom] = useState<FramePoint | undefined>(undefined);
  const pointAt = (event: PointerEvent<HTMLDivElement>) =>
    framePoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      frame,
    );
  return (
    <div
      aria-label={label}
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
      style={style}
    >
      {children}
      <Outlines frame={frame} outlined={outlined} />
    </div>
  );
};

/** `outlined` over a frame of `frame`'s size, each with its size. */
const Outlines = ({
  frame,
  outlined,
}: {
  frame: { width: number; height: number };
  outlined: readonly Outline[];
}) =>
  outlined.map(({ area, key }) => (
    <div
      className={pickedStyles}
      // One pick shades the rest of the frame; several would shade each
      // other.
      data-shaded={outlined.length === 1 ? "" : undefined}
      key={key}
      style={placed(area, frame)}
    >
      <span className={sizeStyles}>
        {`${String(area.width)} × ${String(area.height)}`}
      </span>
    </div>
  ));

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

// No taller than the desk would be, so the dialog fits on the screen.
const previewStyles = css({
  borderRadius: "sm",
  maxBlockSize: "56cqh",
  maxInlineSize: "full",
  objectFit: "contain",
});

// The desk's box, with the preview fitted and centered inside it. The
// preview is out of the flow, so a tall one cannot stretch the box.
const previewBoxStyles = center({
  "& > img": {
    blockSize: "full",
    inlineSize: "full",
    inset: 0,
    maxBlockSize: "none",
    position: "absolute",
  },
  position: "relative",
});

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

/**
 * Where a frame of `frame`'s size is drawn in `box`, scaled to fit and
 * centered as `object-fit: contain` draws it, in percent of the box.
 */
const contained = (
  frame: { width: number; height: number },
  box: { width: number; height: number },
): CSSProperties => {
  const wider = frame.width / frame.height / (box.width / box.height);
  const [width, height] = wider > 1 ? [100, 100 / wider] : [100 * wider, 100];
  return {
    height: `${String(height)}%`,
    left: `${String((100 - width) / 2)}%`,
    top: `${String((100 - height) / 2)}%`,
    width: `${String(width)}%`,
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
