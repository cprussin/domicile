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

/** Glyph size in an entry's tile. */
const TILE_ICON_SIZE = 32;

/** Glyph size beside the folder's name. */
const HEAD_ICON_SIZE = 24;

/**
 * A folder's name over a grid of its entries: folders first, files by kind,
 * and images as thumbnails.
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

/** One entry: a tile showing its kind, over its name. */
const Entry = ({ entry, folder }: { entry: string; folder: string }) => {
  const kind = entryKindOf(entry);
  const name = kind === EntryKind.Folder ? entry.slice(0, -1) : entry;
  return (
    <li className={entryStyles} data-kind={EntryKind[kind]}>
      <span className={tileStyles}>
        {kind === EntryKind.Image ? (
          // Keyed on the image, so a failed load doesn't carry over to the
          // next one.
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
 * An image thumbnail served by the engine, or its kind's glyph if it fails to
 * load (e.g. a dotfile, or a file that is not really an image).
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

/** A count with its noun pluralized, e.g. `1 folder`, `2 files`. */
const counted = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const paneStyles = css({
  display: "flex",
  flexDirection: "column",
});

// The header: the folder's name with an accent-colored glyph tile. Sticky, with
// a frosted background so scrolled tiles don't show through.
const headStyles = hstack({
  backdropFilter: "blur({spacing.3})",
  backgroundColor: "color-mix(in oklab, {colors.background} 75%, transparent)",
  borderBlockEnd: "1px solid {colors.border}",
  flexShrink: 0,
  gap: 3,
  insetBlockStart: 0,
  paddingBlock: 3,
  paddingInline: 4,
  position: "sticky",
  zIndex: 1,
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

// As many columns as fit, each wide enough for a readable name.
const entriesStyles = grid({
  alignContent: "start",
  gap: 1,
  gridTemplateColumns: "repeat(auto-fill, minmax({spacing.22}, 1fr))",
  listStyle: "none",
  margin: 0,
  padding: 3,
});

// A muted desktop hue per kind, so names stand out. Folders use the accent.
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

// The same square for glyphs and thumbnails, so a mixed grid lines up.
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

// Thumbnails fill and crop to the tile rather than letterbox.
const thumbnailStyles = css({
  blockSize: "100%",
  display: "block",
  inlineSize: "100%",
  objectFit: "cover",
});

// At most two lines, centered under the tile.
const entryNameStyles = css({
  color: "foreground",
  fontSize: "xs",
  inlineSize: "100%",
  lineClamp: 2,
  textAlign: "center",
  wordBreak: "break-word",
});
