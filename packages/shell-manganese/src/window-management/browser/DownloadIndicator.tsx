import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";

import { hstack } from "../../../styled-system/patterns";
import type { Downloads } from "./downloads";

type Props = {
  /** The page's downloads in progress. At least one. */
  downloads: Downloads;
};

/**
 * How far a browser window's downloads have come, as a percentage beside a
 * download icon. With a size unknown the icon pulses and no amount is claimed.
 */
export const DownloadIndicator = ({ downloads }: Props) => {
  const percent =
    downloads.totalBytes === 0
      ? undefined
      : Math.floor((downloads.receivedBytes / downloads.totalBytes) * 100);

  return (
    <div
      aria-label={
        downloads.count === 1
          ? "Downloading"
          : `Downloading ${downloads.count} files`
      }
      aria-valuenow={percent}
      className={indicatorStyles}
      data-size-unknown={percent === undefined ? "" : undefined}
      role="progressbar"
    >
      <DownloadSimpleIcon size={14} />
      {percent === undefined ? undefined : `${percent}%`}
    </div>
  );
};

// A capsule like the zoom controls beside it. Fixed-width digits so the bar
// does not shift as the number climbs.
const indicatorStyles = hstack({
  "&[data-size-unknown] svg": {
    animation: "pulse {durations.pulse} {easings.in-out} infinite",
  },
  backgroundColor: "background",
  blockSize: 6,
  border: "1px solid {colors.border}",
  borderRadius: "full",
  color: "accent",
  flex: "none",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  gap: 1,
  paddingInline: 2,
});
