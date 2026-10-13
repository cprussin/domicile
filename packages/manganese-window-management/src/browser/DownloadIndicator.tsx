import { Button } from "@domicile-desktop/component-library/Button";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

import { hstack } from "../../styled-system/patterns";
import type { Downloads } from "./downloads";

type Props = {
  /** The page's downloads. At least one in progress or finished. */
  downloads: Downloads;
  /** Stops showing the finished downloads. */
  onClear: () => void;
};

/**
 * A browser window's downloads: how far the ones in progress have come, or,
 * once none are, that some finished, until the user clears them.
 */
export const DownloadIndicator = ({ downloads, onClear }: Props) =>
  downloads.count === 0 ? (
    <FinishedDownloads completed={downloads.completed} onClear={onClear} />
  ) : (
    <DownloadProgress downloads={downloads} />
  );

/**
 * A percentage beside a download icon. With a size unknown the icon pulses and
 * no amount is claimed.
 */
const DownloadProgress = ({ downloads }: { downloads: Downloads }) => {
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

/** A check and how many finished, with a button to clear them. */
const FinishedDownloads = ({
  completed,
  onClear,
}: {
  completed: number;
  onClear: () => void;
}) => (
  <div className={indicatorStyles} data-finished="">
    <span className={statusStyles} role="status">
      <CheckIcon size={14} weight="bold" />
      {completed === 1 ? "Downloaded" : `${completed} downloaded`}
    </span>
    <Button
      label="Clear finished downloads"
      onClick={onClear}
      rounded
      size="xs"
      variant="ghost"
    >
      <XIcon size={12} weight="bold" />
    </Button>
  </div>
);

// A capsule like the zoom controls beside it. Fixed-width digits so the bar
// does not shift as the number climbs. Finished, it turns the success color and
// the clear button sits inside its edge.
const indicatorStyles = hstack({
  "&[data-finished]": {
    color: "success",
    paddingInlineEnd: 0.5,
  },
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

const statusStyles = hstack({
  gap: 1,
});
