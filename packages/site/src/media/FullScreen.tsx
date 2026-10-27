"use client";

import { Button } from "@domicile-desktop/component-library/Button";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowsOut";
import type { ReactElement } from "react";
import { useRef } from "react";

import { css, cx } from "../../styled-system/css";

type Props = {
  /** The button's name, e.g. "Watch full screen". */
  label: string;
  /** The `<video>` or `<img>` to show full screen. */
  children: ReactElement;
};

/** Safari on iPhone puts only a `<video>` full screen, and only by this. */
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Shows `element` full screen, as far as the browser can. */
const showFullScreen = (element: Element): void => {
  if (element.requestFullscreen !== undefined) {
    void element.requestFullscreen();
  } else if (element instanceof HTMLVideoElement) {
    (element as IosVideo).webkitEnterFullscreen?.();
  } else if (element instanceof HTMLImageElement) {
    // Safari on iPhone has no full screen for a picture: its own tab is the
    // nearest.
    window.open(element.src, "_blank", "noopener");
  }
};

/** A capture with a button in its corner that shows it full screen. */
export const FullScreen = ({ label, children }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className={cx("group", frameStyles)} ref={ref}>
      {children}
      <div className={buttonStyles}>
        <Button
          label={label}
          onClick={() => {
            const media = ref.current?.firstElementChild;
            if (media !== null && media !== undefined) {
              showFullScreen(media);
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

// Out of the way until the capture is pointed at, except on touch screens,
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
