import type { AudioTags } from "@domicile-desktop/sdk/file-preview";
import { MusicNotesIcon } from "@phosphor-icons/react/dist/ssr/MusicNotes";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack, vstack } from "../../styled-system/patterns";
import { clockOf } from "./clock";
import type { FileRow } from "./file-row";
import { homeUrl } from "./media";

/** Glyph size for a song with no cover art. */
const COVER_ICON_SIZE = 56;

/** Number of bars in the level meter. */
const BARS = [0, 1, 2, 3, 4];

/**
 * A song's cover, title, artist and album over a player.
 *
 * `tags` is `undefined` when the host couldn't read them; the engine may still
 * play the file. The meter animates while playing and is decorative: the page
 * can't read the file to draw its real waveform.
 */
export const AudioPreview = ({
  row,
  tags,
}: {
  row: FileRow;
  tags: AudioTags | undefined;
}) => {
  const [playing, setPlaying] = useState(false);
  const byline = [tags?.artist, tags?.album].filter(
    (said) => said !== undefined,
  );
  const stop = () => {
    setPlaying(false);
  };
  return (
    <div className={paneStyles}>
      {tags?.cover !== undefined && (
        <span className={backdropStyles}>
          <img alt="" className={backdropImageStyles} src={tags.cover} />
        </span>
      )}
      {tags?.cover === undefined ? (
        <span className={noCoverStyles}>
          <MusicNotesIcon size={COVER_ICON_SIZE} weight="duotone" />
        </span>
      ) : (
        <img alt="Cover art" className={coverStyles} src={tags.cover} />
      )}
      <div className={textStyles}>
        <h2 className={titleStyles}>{tags?.title ?? row.name}</h2>
        {byline.length > 0 && (
          <span className={bylineStyles}>{byline.join(" · ")}</span>
        )}
      </div>
      <div className={meterRowStyles}>
        <span aria-hidden className={meterStyles} data-playing={playing}>
          {BARS.map((bar) => (
            <span className={barStyles} key={bar} />
          ))}
        </span>
        {tags !== undefined && <span>{clockOf(tags.duration)}</span>}
      </div>
      <audio
        aria-label={`Play ${row.name}`}
        className={playerStyles}
        controls
        onEnded={stop}
        onPause={stop}
        onPlay={() => {
          setPlaying(true);
        }}
        preload="metadata"
        src={homeUrl(row.path)}
      >
        <track kind="captions" />
      </audio>
    </div>
  );
};

// Centered over a blurred copy of the cover, so the pane takes on its colors.
const paneStyles = vstack({
  blockSize: "100%",
  gap: 3,
  isolation: "isolate",
  justifyContent: "center",
  overflow: "hidden",
  padding: 6,
  position: "relative",
});

// The blurred cover, under a scrim so text stays readable, and extended past
// the pane's edges so the blur doesn't fade out at them.
const backdropStyles = css({
  _after: {
    backgroundColor:
      "color-mix(in oklab, {colors.background} 65%, transparent)",
    content: '""',
    inset: 0,
    position: "absolute",
  },
  inset: 0,
  overflow: "hidden",
  position: "absolute",
  zIndex: -1,
});

const backdropImageStyles = css({
  blockSize: "calc(100% + {spacing.24})",
  filter: "blur({spacing.10})",
  inlineSize: "calc(100% + {spacing.24})",
  insetBlockStart: -12,
  insetInlineStart: -12,
  maxInlineSize: "none",
  objectFit: "cover",
  position: "absolute",
});

const coverStyles = css({
  aspectRatio: "1",
  blockSize: 36,
  borderRadius: "xl",
  boxShadow: "lifted",
  flexShrink: 0,
  objectFit: "cover",
});

// Placeholder for a song with no cover: an accent square with a music glyph.
const noCoverStyles = css({
  backgroundImage:
    "linear-gradient(135deg, color-mix(in oklab, {colors.accent} 45%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
  blockSize: 36,
  border: "1px solid color-mix(in oklab, {colors.accent} 40%, transparent)",
  borderRadius: "xl",
  boxShadow: "lifted",
  color: "accent",
  display: "grid",
  flexShrink: 0,
  inlineSize: 36,
  placeItems: "center",
});

const textStyles = vstack({
  gap: 0.5,
  maxInlineSize: "100%",
  textAlign: "center",
});

const titleStyles = css({
  color: "foreground",
  fontSize: "lg",
  fontWeight: "semibold",
  margin: 0,
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const bylineStyles = css({
  color: "muted",
  fontSize: "sm",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const meterRowStyles = hstack({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  gap: 2,
});

// Bars at staggered heights. While playing, each animates with its own offset
// so they read as a level meter rather than one blinking block.
const meterStyles = hstack({
  "& > span:nth-child(2)": {
    animationDelay: "calc(-1 * {durations.slow})",
    blockSize: "70%",
  },
  "& > span:nth-child(3)": {
    animationDelay: "calc(-1 * {durations.fast})",
    blockSize: "45%",
  },
  "& > span:nth-child(4)": {
    animationDelay: "calc(-1 * {durations.slower})",
    blockSize: "85%",
  },
  "& > span:nth-child(5)": {
    animationDelay: "calc(-1 * {durations.normal})",
    blockSize: "30%",
  },
  "&[data-playing=true] > span": {
    _motionReduce: { animationName: "none" },
    animation:
      "equalizer {durations.slowest} {easings.in-out} infinite alternate",
  },
  alignItems: "end",
  blockSize: 4,
  gap: 0.5,
});

const barStyles = css({
  backgroundColor: "accent",
  blockSize: "55%",
  borderRadius: "full",
  inlineSize: 0.75,
  transformOrigin: "bottom",
});

// The engine draws the controls, so it needs the color scheme to match the
// desk.
const playerStyles = css({
  _light: { colorScheme: "light" },
  colorScheme: "dark",
  inlineSize: "100%",
  maxInlineSize: 80,
});
