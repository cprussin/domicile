import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { DOWNLOAD_REGULAR } from "../_icon/phosphor-parts";
import { useCue } from "../_icon/useCue";

/** The tray's floor, which it gives toward. */
const FLOOR = [128, 216] as const;

type Props = {
  /** Drops the arrow again each time it changes, such as for a new download. */
  cue?: unknown;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `DownloadSimple`. Its arrow drops into the tray when it
 * appears and on each cue, and the tray gives under it.
 */
export const AnimatedDownloadIcon = ({ cue, label, size }: Props) => {
  const cued = useCue(cue);
  return (
    <IconFrame label={label} size={size}>
      <IconPart
        cue={cued}
        cueStyles={giveStyles}
        d={DOWNLOAD_REGULAR.tray}
        name="tray"
        origin={FLOOR}
      />
      <IconPart
        cue={cued}
        cueStyles={dropStyles}
        d={DOWNLOAD_REGULAR.arrow}
        name="arrow"
      />
    </IconFrame>
  );
};

// Not keyed on `data-cued`: the drop also plays when the icon appears.
const dropStyles = css({
  animation: "iconDownloadDrop {durations.slowest} {easings.out}",
});

const giveStyles = css({
  animation: "iconTrayGive {durations.slowest} {easings.out}",
});
