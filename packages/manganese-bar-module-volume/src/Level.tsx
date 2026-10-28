import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { Slider } from "@domicile-desktop/component-library/Slider";
import { SliderRow } from "@domicile-desktop/component-library/SliderRow";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { MicrophoneSlashIcon } from "@phosphor-icons/react/dist/ssr/MicrophoneSlash";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import type { ReactNode } from "react";
import { useState } from "react";

import { cva } from "../styled-system/css";

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
  /** A button after the percentage, such as an arrow to the mixer. */
  end?: ReactNode | undefined;
  onLevel: (level: number) => void;
  onMuted: (muted: boolean) => void;
};

/** A pending request, and the reading it was made against. */
type Held = { level: number; over: number };

/**
 * One volume control: mute button, slider with meter, and percentage, for a
 * device or a stream. Gray while muted.
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
  end,
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
    <span className={rowStyles({ muted })} data-muted={muted ? "" : undefined}>
      <SliderRow
        end={end}
        figure={`${percent.toString()}%`}
        lead={
          <IconButton
            aria-pressed={muted}
            label={`${muted ? "Unmute" : "Mute"} ${label}`}
            onClick={() => {
              onMuted(!muted);
            }}
          >
            <MuteIcon direction={direction} muted={muted} />
          </IconButton>
        }
      >
        <Slider
          label={label}
          level={meter}
          levelMuted={muted}
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
      </SliderRow>
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
        <SpeakerSlashIcon size={14} />
      ) : (
        <SpeakerHighIcon size={14} />
      );
    case "input":
      return muted ? (
        <MicrophoneSlashIcon size={14} />
      ) : (
        <MicrophoneIcon size={14} />
      );
  }
};

// Gray while muted, the end button too.
const rowStyles = cva({
  base: { display: "flex", inlineSize: "100%" },
  variants: {
    muted: {
      false: {},
      true: { color: "muted" },
    },
  },
});
