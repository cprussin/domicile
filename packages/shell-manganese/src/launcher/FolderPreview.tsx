import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FileAudioIcon } from "@phosphor-icons/react/dist/ssr/FileAudio";
import { FileCodeIcon } from "@phosphor-icons/react/dist/ssr/FileCode";
import { FileImageIcon } from "@phosphor-icons/react/dist/ssr/FileImage";
import { FilePdfIcon } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { FileVideoIcon } from "@phosphor-icons/react/dist/ssr/FileVideo";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr/FolderOpen";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { grid, hstack, vstack } from "../../styled-system/patterns";
import { EntryKind, entryKindOf } from "./entry-kind";
import type { FileRow } from "./file-row";
import { homeUrl } from "./media";

/** How big a glyph is in an entry's tile. */
const TILE_ICON_SIZE = 32;

/** How big the folder's own glyph is, beside its name. */
const HEAD_ICON_SIZE = 24;

/**
 * A folder as a folder: its name over what it holds, and what it holds as a
 * grid of tiles — folders first, each file drawn as the kind of thing it is,
 * and a picture as itself.
 */
export const FolderPreview = ({
  entries,
  row,
}: {
  entries: readonly string[];
  row: FileRow;
}) => {
  const folders = entries.filter((entry) => entry.endsWith("/"));
  const files = entries.filter((entry) => !entry.endsWith("/"));
  return (
    <div className={paneStyles}>
      <header className={headStyles}>
        <span className={headTileStyles}>
          <FolderOpenIcon size={HEAD_ICON_SIZE} weight="duotone" />
        </span>
        <div className={headTextStyles}>
          <h2 className={nameStyles}>{row.name}</h2>
          <span className={countStyles}>
            {counted(folders.length, "folder")} ·{" "}
            {counted(files.length, "file")}
          </span>
        </div>
      </header>
      <ul className={entriesStyles}>
        {[...folders, ...files].map((entry) => (
          <Entry entry={entry} folder={row.path} key={entry} />
        ))}
      </ul>
    </div>
  );
};

/** One thing in the folder: a tile for what it is, over its name. */
const Entry = ({ entry, folder }: { entry: string; folder: string }) => {
  const kind = entryKindOf(entry);
  const name = kind === EntryKind.Folder ? entry.slice(0, -1) : entry;
  return (
    <li className={entryStyles} data-kind={EntryKind[kind]}>
      <span className={tileStyles}>
        {kind === EntryKind.Image ? (
          // Keyed on the picture, so one that would not load does not leave
          // the next without its own chance.
          <Thumbnail
            key={name}
            name={name}
            url={homeUrl(`${folder}/${name}`)}
          />
        ) : (
          <KindIcon kind={kind} />
        )}
      </span>
      <span className={entryNameStyles}>{name}</span>
    </li>
  );
};

/**
 * A picture in the folder, drawn from where the engine serves the home — or
 * its kind's glyph, for one the engine will not draw: a dotfile, or a file
 * whose name is the only thing about it that is a picture.
 */
const Thumbnail = ({ name, url }: { name: string; url: string }) => {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <KindIcon kind={EntryKind.Image} />
  ) : (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: `error` is the image failing to load, not something a person does to it
    <img
      alt={name}
      className={thumbnailStyles}
      loading="lazy"
      onError={() => {
        setFailed(true);
      }}
      src={url}
    />
  );
};

const KindIcon = ({ kind }: { kind: EntryKind }) => {
  const Icon = ICONS[kind];
  return (
    <Icon
      size={TILE_ICON_SIZE}
      weight={kind === EntryKind.Folder ? "fill" : "duotone"}
    />
  );
};

const ICONS: Readonly<Record<EntryKind, typeof FileIcon>> = {
  [EntryKind.Folder]: FolderIcon,
  [EntryKind.Image]: FileImageIcon,
  [EntryKind.Video]: FileVideoIcon,
  [EntryKind.Audio]: FileAudioIcon,
  [EntryKind.Pdf]: FilePdfIcon,
  [EntryKind.Code]: FileCodeIcon,
  [EntryKind.Other]: FileIcon,
};

/** `1 folder`, `2 files`: a count, and its noun agreeing with it. */
const counted = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const paneStyles = css({
  blockSize: "100%",
  display: "flex",
  flexDirection: "column",
});

// The folder's name the pane's title: a tile in the desktop's accent for the
// glyph, the one splash of color up here, so the head reads as a head and the
// grid under it as what it heads.
const headStyles = hstack({
  borderBlockEnd: "1px solid {colors.border}",
  flexShrink: 0,
  gap: 3,
  paddingBlock: 3,
  paddingInline: 4,
});

const headTileStyles = css({
  backgroundImage:
    "linear-gradient(135deg, color-mix(in oklab, {colors.accent} 35%, transparent), color-mix(in oklab, {colors.accent} 10%, transparent))",
  blockSize: 10,
  border: "1px solid color-mix(in oklab, {colors.accent} 40%, transparent)",
  borderRadius: "lg",
  color: "accent",
  display: "grid",
  flexShrink: 0,
  inlineSize: 10,
  placeItems: "center",
});

const headTextStyles = css({
  display: "flex",
  flexDirection: "column",
  minInlineSize: 0,
});

const nameStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "semibold",
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});

// As many columns as fit, each wide enough for a name to be read, and the
// grid alone scrolls: the head stays where it is.
const entriesStyles = grid({
  alignContent: "start",
  flex: "1 1 auto",
  gap: 1,
  gridTemplateColumns: "repeat(auto-fill, minmax({spacing.22}, 1fr))",
  listStyle: "none",
  margin: 0,
  minBlockSize: 0,
  overflowY: "auto",
  padding: 3,
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
});

// Each kind a hue of the desktop's own, quiet enough on its tile that the grid
// reads as names first: folders in the accent, since they are where the
// folder goes on to.
const entryStyles = vstack({
  "&[data-kind=Audio]": { color: "warning" },
  "&[data-kind=Code]": {
    color: "color-mix(in oklab, {colors.accent} 55%, {colors.foreground})",
  },
  "&[data-kind=Folder]": { color: "accent" },
  "&[data-kind=Image]": { color: "success" },
  "&[data-kind=Pdf]": { color: "danger" },
  "&[data-kind=Video]": {
    color: "color-mix(in oklab, {colors.warning} 60%, {colors.danger})",
  },
  borderRadius: "md",
  color: "muted",
  gap: 1.5,
  padding: 1.5,
});

// A square of ground for the entry to sit on, the same for a glyph and for a
// picture, so a folder of both still lines up.
const tileStyles = css({
  aspectRatio: "1",
  backgroundColor: "color-mix(in oklab, {colors.foreground} 5%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  borderRadius: "lg",
  display: "grid",
  inlineSize: "100%",
  overflow: "hidden",
  placeItems: "center",
});

// A picture fills its tile and is cropped to it: a thumbnail is recognized by
// its middle, and a letterboxed one would be a smaller picture in a frame.
const thumbnailStyles = css({
  blockSize: "100%",
  display: "block",
  inlineSize: "100%",
  objectFit: "cover",
});

// Two lines of name at most, centered under the tile, in the foreground: the
// name is what is read, and the tile only says what kind of thing it names.
const entryNameStyles = css({
  color: "foreground",
  fontSize: "xs",
  inlineSize: "100%",
  lineClamp: 2,
  textAlign: "center",
  wordBreak: "break-word",
});
