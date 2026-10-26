import { css, cva, cx } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";
import { captured } from "./captured";
import { Video } from "./Video";

type Props = {
  /** The capture's name in `docs/media/`, without an extension. */
  name: string;
  /** What it shows, for screen readers and while it is not captured yet. */
  alt: string;
  /** `screen` is 16:10, the captures' own shape; `wide` is 16:9. */
  shape?: "screen" | "wide" | undefined;
};

/**
 * A captured screenshot, or a muted video loop that can play full screen.
 * Until the scene has been captured it shows what it will be.
 */
export const Media = ({ name, alt, shape = "screen" }: Props) => {
  const media = captured(name);
  switch (media.kind) {
    case "video": {
      return (
        <Video alt={alt} className={mediaStyles({ shape })} video={media} />
      );
    }
    case "picture": {
      return (
        // Captures are already sized for the page, so `next/image` would
        // only re-encode them.
        <img alt={alt} className={mediaStyles({ shape })} src={media.png} />
      );
    }
    case "missing": {
      return (
        <div className={cx(mediaStyles({ shape }), missingStyles)}>
          <span className={badgeStyles}>Not captured yet</span>
          <span>{alt}</span>
        </div>
      );
    }
  }
};

const mediaStyles = cva({
  base: {
    blockSize: "auto",
    border: "1px solid {colors.border}",
    borderRadius: "2xl",
    inlineSize: "100%",
    objectFit: "cover",
  },
  variants: {
    shape: {
      screen: { aspectRatio: "screen" },
      wide: { aspectRatio: "wide" },
    },
  },
});

const missingStyles = center({
  backgroundColor: "card",
  borderColor: "accent",
  borderStyle: "dashed",
  color: "muted",
  flexDirection: "column",
  fontSize: "sm",
  gap: 2,
  padding: 4,
  textAlign: "center",
});

const badgeStyles = css({
  backgroundColor: "accent",
  borderRadius: "sm",
  color: "background",
  fontSize: "xs",
  fontWeight: "semibold",
  letterSpacing: "wider",
  paddingBlock: 0.75,
  paddingInline: 2,
  textTransform: "uppercase",
});
