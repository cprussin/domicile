import type {
  FrozenDesk,
  PortalAnswer,
  ShotRect,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import type { PointerEvent } from "react";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: FrozenDesk;
  screen: string | undefined;
};

/**
 * Picks the area of a frozen desk to save: all of it, a monitor, a window, or
 * an area dragged over it. Dismissing it cancels.
 */
export const ScreenshotDialog = ({ answer, asker, body, screen }: Props) => {
  const choices = [
    {
      area: { height: body.height, width: body.width, x: 0, y: 0 },
      name: "Whole desk",
    },
    ...body.monitors,
    ...body.windows,
  ];
  // The index of the choice picked, or the area dragged.
  const [picked, setPicked] = useState<number | ShotRect>(0);
  const [dragFrom, setDragFrom] = useState<FramePoint | undefined>(undefined);
  const area = typeof picked === "number" ? choices[picked]?.area : picked;
  if (area === undefined) {
    throw new Error(`no screenshot choice ${String(picked)}`);
  }
  const pointAt = (event: PointerEvent<HTMLDivElement>) =>
    framePoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      body,
    );
  return (
    <ModalDialog
      closeButton={false}
      footer={
        <>
          <Button
            onClick={() => {
              answer(Answer.Canceled());
            }}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              answer(Answer.Screenshot(area));
            }}
          >
            Save
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) {
          answer(Answer.Canceled());
        }
      }}
      open
      screen={screen}
      size="xl"
      title="Take a screenshot"
    >
      <p className={askerStyles}>{`${asker} asks`}</p>
      <div className={choicesStyles}>
        {choices.map((choice, index) => (
          <Button
            aria-pressed={index === picked}
            // Names repeat, as two untitled windows do; the order is fixed.
            key={index}
            onClick={() => {
              setPicked(index);
            }}
            size="sm"
            variant={index === picked ? "primary" : "outline"}
          >
            {choice.name}
          </Button>
        ))}
      </div>
      <div
        aria-label="Drag to pick an area"
        className={deskStyles}
        onPointerDown={(event) => {
          const from = pointAt(event);
          setDragFrom(from);
          setPicked(draggedArea(from, from));
        }}
        onPointerMove={(event) => {
          if (dragFrom !== undefined) {
            setPicked(draggedArea(dragFrom, pointAt(event)));
          }
        }}
        onPointerUp={() => {
          setDragFrom(undefined);
        }}
        role="group"
      >
        <img
          alt="The desk"
          className={frameStyles}
          draggable={false}
          src={body.frame}
        />
        <div className={pickedStyles} style={placed(area, body)} />
      </div>
    </ModalDialog>
  );
};

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const choicesStyles = flex({ gap: 2, marginBlock: 3, wrap: "wrap" });

const deskStyles = css({
  cursor: "crosshair",
  // Keeps the shade around the picked area on the frame.
  overflow: "hidden",
  position: "relative",
  touchAction: "none",
  userSelect: "none",
});

const frameStyles = css({ display: "block", width: "full" });

const pickedStyles = css({
  borderColor: "accent",
  borderStyle: "solid",
  borderWidth: "2px",
  boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
  pointerEvents: "none",
  position: "absolute",
});

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
