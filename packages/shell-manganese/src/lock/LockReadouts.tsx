import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { system } from "@domicile-desktop/sdk/system";
import type { Audio } from "@domicile-desktop/system-audio/audio";
import type { SoundServer } from "@domicile-desktop/system-audio/sound-server";
import { soundServer } from "@domicile-desktop/system-audio/sound-server";
import { useEffect, useMemo, useState } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Battery } from "../battery/Battery";
import { watchBattery as defaultWatchBattery } from "../battery/watch-battery";
import { BrightnessSlider } from "../brightness/BrightnessSlider";
import { hostBacklight } from "../brightness/host-backlight";
import { useBrightness } from "../brightness/useBrightness";
import { ask } from "../volume/ask";
import { Level } from "../volume/Level";
import { primary } from "../volume/primary";

type Props = {
  /** The desktop whose system calls reach UPower, the backlight and audio. */
  domicile: DomicileHost;
  /** Injectable so tests can drive their own backlight. */
  backlight?: typeof hostBacklight | undefined;
  /** Injectable so tests can drive their own sound server. */
  sound?: typeof defaultSound | undefined;
  /** Injectable so tests can drive their own battery. */
  watchBattery?: typeof defaultWatchBattery | undefined;
};

/**
 * The battery, brightness and volume on the lock screen, so a locked laptop
 * can be dimmed or quieted. Each is hidden on a desk without it.
 *
 * The compositor allows these system calls while locked. See docs/LOCK.md.
 */
export const LockReadouts = ({
  backlight = hostBacklight,
  domicile,
  sound = defaultSound,
  watchBattery = defaultWatchBattery,
}: Props) => {
  const brightness = useBrightness(domicile, backlight);
  const server = useMemo(() => sound(domicile), [sound, domicile]);
  return (
    <div className={paneStyles}>
      <span className={batteryStyles}>
        <Battery domicile={domicile} watch={watchBattery} />
      </span>
      {brightness === undefined ? undefined : (
        <BrightnessSlider control={brightness} />
      )}
      <Volume server={server} />
    </div>
  );
};

const defaultSound = (domicile: DomicileHost): SoundServer =>
  soundServer(system(domicile));

/** The default output's volume and mute. */
const Volume = ({ server }: { server: SoundServer }) => {
  const [audio, setAudio] = useState<Audio | undefined>(undefined);
  useEffect(() => server.watch(setAudio), [server]);
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
