import { Slider } from "@domicile-desktop/component-library/Slider";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { MicrophoneSlashIcon } from "@phosphor-icons/react/dist/ssr/MicrophoneSlash";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleHigh";
import { SpeakerSimpleXIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSimpleX";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

/** The sound's direction, which picks the mute button's icon. */
export type Direction = "output" | "input";

type Props = {
  direction: Direction;
  /** The slider's label, also used to name its mute button. */
  label: string;
  /** The current volume, as a fraction of the server's 100%. */
  level: number;
  /** The current level, 0 to 1 of the meter; absent for no meter. */
  meter?: number | undefined;
  muted: boolean;
  onLevel: (level: number) => void;
  onMuted: (muted: boolean) => void;
};

/** A pending request, and the reading it was made against. */
type Held = { level: number; over: number };

/**
 * One volume control: mute button, slider with meter, and percentage, for a
 * device or a stream.
 *
 * Like brightness, it follows the compositor rather than the drag. The dragged
 * value is held during and after the drag until a new value arrives, because
 * answers to earlier requests from the same drag would make it jump back.
 *
 * It never sets above 100%. A device raised past that elsewhere shows its value
 * and sits at the end of the track; moving it brings it back in range.
 */
export const Level = ({
  direction,
  label,
  level,
  meter,
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
        level={meter}
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

// The bar's button style, not the library's, as in brightness: it uses
// `currentcolor`, so it is white on the bar and `foreground` in the mixer.
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

// The same figure style as brightness, for the same reason.
const percentStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 7,
  textAlign: "end",
});
