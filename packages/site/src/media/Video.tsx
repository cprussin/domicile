"use client";

import { Button } from "@domicile-desktop/component-library/Button";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowsOut";
import { useRef } from "react";

import { css, cx } from "../../styled-system/css";

type Props = {
  /** What it shows, for screen readers. */
  alt: string;
  /** The video's own styles, from `Media`. */
  className: string;
  video: { webm: string; mp4: string; poster: string | undefined };
};

/** Safari on iPhone puts only a `<video>` itself full screen, by this. */
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** A muted video loop, with a button that plays it full screen. */
export const Video = ({ alt, className, video }: Props) => {
  const ref = useRef<IosVideo>(null);
  return (
    <div className={cx("group", frameStyles)}>
      <video
        aria-label={alt}
        autoPlay
        className={className}
        loop
        muted
        playsInline
        poster={video.poster}
        ref={ref}
      >
        <source src={video.webm} type="video/webm" />
        <source src={video.mp4} type="video/mp4" />
      </video>
      <div className={buttonStyles}>
        <Button
          label="Watch full screen"
          onClick={() => {
            const element = ref.current;
            if (element === null) {
              return;
            }
            if (element.requestFullscreen === undefined) {
              element.webkitEnterFullscreen?.();
            } else {
              void element.requestFullscreen();
            }
          }}
          size="sm"
          variant="solid"
        >
          <ArrowsOutIcon />
        </Button>
      </div>
    </div>
  );
};

const frameStyles = css({ position: "relative" });

// Out of the way until the video is pointed at, except on touch screens,
// which have no pointing.
const buttonStyles = css({
  "@media (hover: hover)": {
    _focusWithin: { opacity: 1 },
    _groupHover: { opacity: 1 },
    opacity: 0,
  },
  insetBlockStart: 3,
  insetInlineEnd: 3,
  position: "absolute",
  transition: "opacity 0.15s",
});
