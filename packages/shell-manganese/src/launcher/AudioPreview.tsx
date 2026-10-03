import type { AudioTags } from "@domicile/sdk/file-preview";
import { MusicNotesIcon } from "@phosphor-icons/react/dist/ssr/MusicNotes";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack, vstack } from "../../styled-system/patterns";
import { clockOf } from "./clock";
import type { FileRow } from "./file-row";
import { homeUrl } from "./media";

/** How big the glyph is on a song with no picture of its own. */
const COVER_ICON_SIZE = 56;

/** How many bars the meter beside the length has. */
const BARS = [0, 1, 2, 3, 4];

/**
 * A song by what it says of itself — its picture, its title, who made it and
 * on what — over a player for it. `tags` is `undefined` for a file the host
 * could not read as one, which is still a file the engine may play: it is
 * named, and offered.
 *
 * The meter beside the length moves while the song plays and rests when it
 * does not. It is not the song's own waveform: the page cannot read the file
 * to draw one, and a picture of a sound that was not this one would be a lie.
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

// The song centered in the pane, over a wash of its own picture: the pane
// takes on the record's colors without the picture being drawn twice at a
// size anyone reads.
const paneStyles = vstack({
  blockSize: "100%",
  gap: 3,
  isolation: "isolate",
  justifyContent: "center",
  overflow: "hidden",
  padding: 6,
  position: "relative",
});

// The picture blurred to a wash, a scrim of the pane's own ground over it so
// the text on top reads on any sleeve, and drawn past the pane's edges, where
// the blur would otherwise fade to nothing.
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

// A record with no sleeve: the same square, lit in the desktop's accent, with
// the glyph for music where the picture would be.
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

// Five bars in the accent, resting at staggered heights and, while the song
// plays, each bouncing on a beat of its own: offsets rather than one beat, so
// the five read as a level rather than as a single blinking block.
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

// The engine draws the controls, so it is told which way round the desk is
// or it draws a light player on a dark desk.
const playerStyles = css({
  _light: { colorScheme: "light" },
  colorScheme: "dark",
  inlineSize: "100%",
  maxInlineSize: 80,
});
