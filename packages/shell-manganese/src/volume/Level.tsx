import { Slider } from "@domicile/component-library/Slider";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { MicrophoneSlashIcon } from "@phosphor-icons/react/dist/ssr/MicrophoneSlash";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleHigh";
import { SpeakerSimpleXIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleX";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

/** Which way the sound goes, which is what the mute button is drawn as. */
export type Direction = "output" | "input";

type Props = {
  direction: Direction;
  /** What the slider sets, and what its mute button names. */
  label: string;
  /** Where the desk says it is, as a fraction of the server's 100%. */
  level: number;
  muted: boolean;
  onLevel: (level: number) => void;
  onMuted: (muted: boolean) => void;
};

/** A request still on its way, and the reading it was made over. */
type Held = { level: number; over: number };

/**
 * One volume: a mute button, a slider and the figure — a device's or a
 * stream's, on the bar's panel or in the mixer.
 *
 * **It follows the desk, not its own drag**, as the brightness does: a move
 * asks the compositor, and what comes back is the level every chrome is told.
 * What the slider was moved to is held while it is dragged, and after, until
 * the desk says something new — the answers to the drag's own earlier requests
 * arrive behind it, and a slider that took them would jump back.
 *
 * **Never past 100%** from here. A device another mixer turned up beyond it
 * reads its figure and sits at the end of the track; moving it brings it back
 * within.
 */
export const Level = ({
  direction,
  label,
  level,
  muted,
  onLevel,
  onMuted,
}: Props) => {
  const [held, setHeld] = useState<Held | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const shown =
    held !== undefined && (dragging || held.over === level)
      ? held.level
      : level;
  const percent = Math.round(shown * 100);
  return (
    <span className={rowStyles}>
      <button
        aria-label={`${muted ? "Unmute" : "Mute"} ${label}`}
        aria-pressed={muted}
        className={muteStyles}
        onClick={() => {
          onMuted(!muted);
        }}
        type="button"
      >
        <MuteIcon direction={direction} muted={muted} />
      </button>
      <Slider
        label={label}
        max={100}
        min={0}
        onValueChange={(value) => {
          setDragging(true);
          setHeld({ level: value / 100, over: level });
          onLevel(value / 100);
        }}
        onValueCommitted={() => {
          setDragging(false);
        }}
        step={1}
        value={Math.min(100, percent)}
      />
      <span className={percentStyles}>{percent}%</span>
    </span>
  );
};

const MuteIcon = ({
  direction,
  muted,
}: {
  direction: Direction;
  muted: boolean;
}) => {
  switch (direction) {
    case "output":
      return muted ? (
        <SpeakerSimpleXIcon size={14} />
      ) : (
        <SpeakerSimpleHighIcon size={14} />
      );
    case "input":
      return muted ? (
        <MicrophoneSlashIcon size={14} />
      ) : (
        <MicrophoneIcon size={14} />
      );
  }
};

const rowStyles = hstack({
  gap: 2,
  inlineSize: "100%",
});

// THE BAR'S BUTTON, AND NOT THE LIBRARY'S, for the brightness's reason: drawn
// in `currentcolor`, so it is white on the bar's panel and `foreground` in the
// mixer, where the library's ghost would be gray over a photograph.
const muteStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 6,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});

// The brightness's figures, and for their reason.
const percentStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 7,
  textAlign: "end",
});
