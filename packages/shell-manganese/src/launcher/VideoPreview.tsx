import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { clockOf } from "./clock";

/** How big the play glyph is in the badge. */
const PLAY_ICON_SIZE = 12;

/**
 * A video as one still, a tenth of the way in, with its length over it.
 *
 * A still rather than the video playing, because a preview that moves pulls
 * the eye off the list it is a preview of; and a way in rather than its first
 * frame, which for most videos is black. The engine draws the frame: the
 * element loads only enough to seek, and never plays.
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

/** Where the still is taken: a tenth in, or the start of one of no length. */
const stillAt = (duration: number): number =>
  Number.isFinite(duration) ? duration / 10 : 0;

const paneStyles = css({
  blockSize: "100%",
  position: "relative",
});

// The whole frame, never cropped: a still is a picture of the video, and a
// cropped one is a picture of part of it.
const videoStyles = css({
  blockSize: "100%",
  display: "block",
  inlineSize: "100%",
  objectFit: "contain",
});

// The length in a pill in the corner, on a frosted ground of the pane's own
// color, so it reads over a frame of any brightness.
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
