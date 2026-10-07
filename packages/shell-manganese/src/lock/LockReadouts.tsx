import type { Audio } from "@domicile-desktop/system-audio/audio";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Battery } from "../battery/Battery";
import { BrightnessSlider } from "../brightness/BrightnessSlider";
import { useBrightness } from "../brightness/useBrightness";
import type { Readouts, SoundControls } from "../readouts/readouts";
import type { SharedWatch } from "../readouts/shared-watch";
import { useSharedWatch } from "../readouts/useSharedWatch";
import { ask } from "../volume/ask";
import { Level } from "../volume/Level";
import { primary } from "../volume/primary";

type Props = {
  /** The desk's readouts, shared with the bars. */
  readouts: Pick<Readouts, "audio" | "backlight" | "battery" | "sound">;
};

/**
 * The battery, brightness and volume on the lock screen, so a locked laptop
 * can be dimmed or quieted. Each is hidden on a desk without it.
 *
 * The compositor allows these system calls while locked. See docs/LOCK.md.
 */
export const LockReadouts = ({
  readouts: { audio, backlight, battery, sound },
}: Props) => {
  const brightness = useBrightness(backlight);
  return (
    <div className={paneStyles}>
      <span className={batteryStyles}>
        <Battery battery={battery} />
      </span>
      {brightness === undefined ? undefined : (
        <BrightnessSlider control={brightness} />
      )}
      <Volume audio={audio} server={sound} />
    </div>
  );
};

/** The default output's volume and mute. */
const Volume = ({
  audio: watch,
  server,
}: {
  audio: SharedWatch<Audio>;
  server: SoundControls;
}) => {
  const audio = useSharedWatch(watch);
  const output = audio === undefined ? undefined : primary(audio.outputs);
  return output === undefined ? undefined : (
    <Level
      direction="output"
      label="Volume"
      level={output.volume}
      muted={output.muted}
      onLevel={(level) => {
        ask(server.setVolume(output.id, level));
      }}
      onMuted={(muted) => {
        ask(server.setMuted(output.id, muted));
      }}
    />
  );
};

// A glass pane like the passphrase field's, hidden while it holds nothing.
const paneStyles = flex({
  "&:not(:has([role=meter], input[type=range]))": {
    display: "none",
  },
  backdropFilter: "blur({spacing.6}) saturate(180%)",
  backgroundColor: "color-mix(in oklab, {colors.card} 55%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 14%, transparent)",
  borderRadius: "3xl",
  boxShadow: "modal",
  color: "foreground",
  direction: "column",
  gap: 2,
  inlineSize: 96,
  paddingBlock: 3,
  paddingInline: 4,
});

// The battery draws itself at the bar's size; centered above the sliders.
const batteryStyles = css({
  _empty: { display: "none" },
  alignSelf: "center",
});
