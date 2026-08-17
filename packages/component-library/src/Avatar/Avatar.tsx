import type { ImageLoadingStatus } from "@base-ui/react/avatar";
import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { useState } from "react";
import { css, cva } from "../../styled-system/css";
import { center, circle } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

import { getGradient } from "./gradient";
import { getInitials } from "./initials";

export const AVATAR_SIZES = [
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

type Props = ExtendProps<
  typeof BaseAvatar.Root,
  {
    alt?: string | undefined;
    children?: undefined;
    name: string;
    size?: AvatarSize | undefined;
    src?: string | undefined;
  }
>;

export const Avatar = ({ name, size = "md", src, alt, ...props }: Props) => {
  const [status, setStatus] = useState<ImageLoadingStatus>("idle");

  const fallbackVisible = src === undefined || status === "error";
  return (
    <BaseAvatar.Root {...props} className={rootStyles({ size })}>
      <span
        aria-hidden
        className={skeletonStyles({ loading: status === "loading" })}
      />
      {src !== undefined && (
        // `key={src}` so the Image remounts when `src` changes, re-issuing
        // `onLoadingStatusChange` from "idle" → "loading" → final. Without
        // the key, a previously-loaded Image stays mounted and `status`
        // stays at its prior value through the transition, briefly mismatching
        // the new src's actual load state.
        <BaseAvatar.Image
          alt={alt ?? name}
          className={imageStyles}
          key={src}
          onLoadingStatusChange={setStatus}
          src={src}
        />
      )}
      <BaseAvatar.Fallback
        className={fallbackStyles({ visible: fallbackVisible })}
        style={{ backgroundImage: getGradient(name) }}
      >
        {getInitials(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
};

const skeletonStyles = cva({
  base: {
    backgroundColor: "skeleton",
    inset: 0,
    position: "absolute",
  },
  variants: {
    loading: {
      false: { animation: "none" },
      true: { animation: "pulse {durations.pulse} {easings.in-out} infinite" },
    },
  },
});

const imageStyles = css({
  inset: 0,
  objectFit: "cover",
  opacity: { _starting: 0, base: 1 },
  position: "absolute",
  transition: "opacity {durations.slowest} {easings.out}",
});

const fallbackStyles = cva({
  base: center.raw({
    inset: 0,
    position: "absolute",
    transition: "opacity {durations.slowest} {easings.out}",
  }),
  variants: {
    visible: {
      false: { opacity: 0 },
      true: { opacity: 1 },
    },
  },
});

const rootStyles = cva({
  base: {
    color: "background",
    fontWeight: "bold",
    letterSpacing: "wide",
    overflow: "hidden",
    position: "relative",
    textTransform: "uppercase",
  },
  variants: {
    // biome-ignore assist/source/useSortedKeys: The sort order is useful here
    size: {
      "2xs": circle.raw({ fontSize: "xs", size: 6 }),
      xs: circle.raw({ fontSize: "sm", size: 8 }),
      sm: circle.raw({ fontSize: "lg", size: 12 }),
      md: circle.raw({ fontSize: "2xl", size: 16 }),
      lg: circle.raw({ fontSize: "3xl", size: 20 }),
      xl: circle.raw({ fontSize: "4xl", size: 24 }),
      "2xl": circle.raw({ fontSize: "5xl", size: 28 }),
    },
  },
});
