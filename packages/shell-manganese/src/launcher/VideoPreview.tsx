import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { clockOf } from "./clock";

/** Play glyph size in the badge. */
const PLAY_ICON_SIZE = 12;

/**
 * A still from a tenth of the way into a video, with its duration.
 *
 * A still, because motion distracts from the list. Not the first frame,
 * because it is often black. The element loads only enough to seek.
 */
export const VideoPreview = ({
  name,
  onError,
  url,
}: {
  name: string;
  onError: () => void;
  url: string;
}) => {
  const [duration, setDuration] = useState<number | undefined>(undefined);
  return (
    <div className={paneStyles}>
      <video
        aria-label={name}
        className={videoStyles}
        muted
        onError={onError}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          video.currentTime = stillAt(video.duration);
          setDuration(video.duration);
        }}
        preload="metadata"
        src={url}
      >
        <track kind="captions" />
      </video>
      {duration !== undefined && Number.isFinite(duration) && (
        <span className={badgeStyles}>
          <PlayIcon size={PLAY_ICON_SIZE} weight="fill" />
          {clockOf(duration)}
        </span>
      )}
    </div>
  );
};

/** Time of the still: a tenth in, or 0 for a video with no duration. */
const stillAt = (duration: number): number =>
  Number.isFinite(duration) ? duration / 10 : 0;

const paneStyles = css({
  blockSize: "100%",
  position: "relative",
});

// Show the whole frame, uncropped.
const videoStyles = css({
  blockSize: "100%",
  display: "block",
  inlineSize: "100%",
  objectFit: "contain",
});

// Duration pill on a frosted background, readable over any frame.
const badgeStyles = hstack({
  backdropFilter: "blur({spacing.2})",
  backgroundColor: "color-mix(in oklab, {colors.background} 70%, transparent)",
  borderRadius: "full",
  color: "foreground",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  gap: 1,
  insetBlockEnd: 3,
  insetInlineEnd: 3,
  paddingBlock: 1,
  paddingInline: 2.5,
  position: "absolute",
});
