import { ArrowBendLeftUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowBendLeftUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { DesktopIcon } from "@phosphor-icons/react/dist/ssr/Desktop";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/ssr/FileArrowUp";
import { FileAudioIcon } from "@phosphor-icons/react/dist/ssr/FileAudio";
import { FileCodeIcon } from "@phosphor-icons/react/dist/ssr/FileCode";
import { FileImageIcon } from "@phosphor-icons/react/dist/ssr/FileImage";
import { FilePdfIcon } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { FilesIcon } from "@phosphor-icons/react/dist/ssr/Files";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { FileVideoIcon } from "@phosphor-icons/react/dist/ssr/FileVideo";
import { FileZipIcon } from "@phosphor-icons/react/dist/ssr/FileZip";
import { FilmStripIcon } from "@phosphor-icons/react/dist/ssr/FilmStrip";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/ssr/FloppyDisk";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr/FolderOpen";
import { HardDrivesIcon } from "@phosphor-icons/react/dist/ssr/HardDrives";
import { HouseIcon } from "@phosphor-icons/react/dist/ssr/House";
import { ImageIcon } from "@phosphor-icons/react/dist/ssr/Image";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { MusicNotesIcon } from "@phosphor-icons/react/dist/ssr/MusicNotes";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useId, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, grid, hstack, vstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { Input } from "../Input/Input";
import { Kbd } from "../Kbd/Kbd";
import { highlightIn, keepInView, stepOf, steppedTo } from "../list-walk";
import { Select } from "../Select/Select";
import { FileKind, fileKindOf, kindLabel } from "./file-kind";
import type { FileFilter, FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";
import { pathIn } from "./path-in";
import type { Row } from "./rows";
import { RowKind, rowsIn } from "./rows";
import { ListingState, useListing } from "./useListing";
import { crumbsOf, parentOf, shownPath, walked } from "./walk-path";

/** The filter box's accessible name. */
const PROMPT = "Filter or go to a path";

/** The filter box's placeholder, listing the path shortcuts. */
const PLACEHOLDER = "Filter, or type a path:  /  root   ~  home   ..  up";

/** The icon size for rows and the filter box. */
const ICON_SIZE = 16;

/** The icon size for empty-state placeholders. */
const PLACEHOLDER_ICON_SIZE = 40;

/**
 * The standard home folders and their icons, in file manager order. The
 * sidebar shows those that exist.
 */
const STANDARD_PLACES: readonly (readonly [string, typeof FolderIcon])[] = [
  ["Desktop", DesktopIcon],
  ["Documents", FileTextIcon],
  ["Downloads", DownloadSimpleIcon],
  ["Music", MusicNotesIcon],
  ["Pictures", ImageIcon],
  ["Videos", FilmStripIcon],
];

type Props = {
  /** The filter box, for the caller to focus while the picker is open. */
  ref?: Ref<HTMLInputElement> | undefined;
  /** What to pick and how to answer. */
  request: FileRequest;
};

/** A sidebar entry. */
type Place = { glyph: typeof FolderIcon; label: string; path: string };

/**
 * A file picker drawn over its positioned parent only, so the rest of the
 * screen stays usable.
 *
 * Starts in `currentFolder`, or the home, and lists one directory at a time; nothing is
 * indexed. Typing filters; a `/` walks the path like a shell (see `walked`).
 * A click or arrow key selects a file; Enter, a double click or the button
 * chooses it. Clicking a directory enters it.
 *
 * Keys: arrows move, Enter opens, Backspace in an empty box goes up,
 * Ctrl+Enter confirms, Escape cancels, and Tab marks a file in multi-select,
 * as in fzf.
 */
export const FilePicker = ({ ref, request }: Props) => {
  const titleId = useId();
  const listId = useId();
  const [directory, setDirectory] = useState(
    request.currentFolder ?? request.home,
  );
  const [query, setQuery] = useState("");
  // The highlighted row, or `undefined` for the default: the first row below
  // `..`.
  const [stepped, setStepped] = useState<number | undefined>(undefined);
  // Marked file paths for multi-select, in marking order.
  const [marks, setMarks] = useState<readonly string[]>([]);
  const [name, setName] = useState(request.suggestedName);
  const [filter, setFilter] = useState<FileFilter | undefined>(
    request.filters?.[0],
  );

  const listing = useListing(request.list, directory);
  // Lists the home directory to find which standard folders exist.
  const homeListing = useListing(request.list, request.home);
  const rows = rowsIn({
    accept: filter === undefined ? request.accept : filter.extensions,
    directory,
    entries: listing.state === ListingState.Listed ? listing.entries : [],
    filter: query,
    mode: request.mode,
  });
  const highlighted = highlightIn(rows.length, stepped ?? firstOf(rows));
  const current = highlighted === undefined ? undefined : rows[highlighted];
  const multiple = request.mode === ChooserMode.OpenMultiple;
  const answer = answerOf({
    current,
    directory,
    marks,
    mode: request.mode,
    name,
  });

  const go = (to: string) => {
    setDirectory(to);
    setQuery("");
    setStepped(undefined);
  };

  const confirm = () => {
    if (answer !== undefined) {
      request.choose(answer);
    }
  };

  // Enter or double click: enters a directory, or chooses a file (or names
  // it, when saving).
  const open = (row: Row) => {
    switch (row.kind) {
      case RowKind.Parent:
      case RowKind.Directory: {
        go(row.path);
        break;
      }
      case RowKind.File: {
        openFile(row);
        break;
      }
    }
  };

  const openFile = (row: Row) => {
    switch (request.mode) {
      case ChooserMode.Open:
      case ChooserMode.OpenFolder: {
        request.choose([row.path]);
        break;
      }
      case ChooserMode.OpenMultiple: {
        request.choose(marks.length > 0 ? marks : [row.path]);
        break;
      }
      case ChooserMode.Save: {
        setName(row.name);
        break;
      }
    }
  };

  // A single click: enters a directory, or selects a file and marks or names
  // it as the mode requires.
  const pick = (row: Row, at: number) => {
    if (row.kind === RowKind.File) {
      setStepped(at);
      if (multiple) {
        setMarks(toggled(marks, row.path));
      } else if (request.mode === ChooserMode.Save) {
        setName(row.name);
      }
    } else {
      go(row.path);
    }
  };

  // Ctrl+Enter in either field confirms the current selection.
  const confirmOnChord = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape closes the dialog wherever focus is inside it
    <dialog
      aria-labelledby={titleId}
      className={scrimStyles}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          request.cancel();
        }
      }}
      open
    >
      <div className={panelStyles}>
        <aside className={sidebarStyles}>
          <div className={brandStyles}>
            <span className={brandTileStyles}>
              <ModeGlyph mode={request.mode} />
            </span>
            <div className={brandTextStyles}>
              <h2 className={titleStyles} id={titleId}>
                {request.title ?? titleOf(request.mode)}
              </h2>
              <span className={subtitleStyles}>{subtitleOf(request.mode)}</span>
            </div>
          </div>
          <nav aria-label="Places" className={placesStyles}>
            <span aria-hidden className={sectionLabelStyles}>
              Places
            </span>
            {placesOf(
              request.home,
              homeListing.state === ListingState.Listed
                ? homeListing.entries
                : [],
            ).map(({ glyph: Glyph, label, path }) => (
              <Button
                aria-current={path === directory ? "location" : undefined}
                beforeIcon={
                  <Glyph
                    size={ICON_SIZE}
                    weight={path === directory ? "fill" : "duotone"}
                  />
                }
                key={path}
                onClick={() => {
                  go(path);
                }}
                // The keyboard stays in the box.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                size="sm"
                variant="ghost"
              >
                {label}
              </Button>
            ))}
          </nav>
          <Keys mode={request.mode} />
        </aside>
        <section className={mainStyles}>
          <nav aria-label="Path" className={pathBarStyles}>
            {crumbsOf(directory, request.home).map((crumb, at, crumbs) => (
              <span className={crumbStyles} key={crumb.path}>
                {at > 0 && (
                  <span aria-hidden className={crumbSeparatorStyles}>
                    <CaretRightIcon size={12} weight="bold" />
                  </span>
                )}
                <Button
                  aria-current={
                    at === crumbs.length - 1 ? "location" : undefined
                  }
                  beforeIcon={
                    at === 0 ? <CrumbGlyph label={crumb.label} /> : undefined
                  }
                  onClick={() => {
                    go(crumb.path);
                  }}
                  // The keyboard stays in the box.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  size="xs"
                  variant="ghost"
                >
                  {crumb.label}
                </Button>
              </span>
            ))}
          </nav>
          <Input
            aria-activedescendant={
              highlighted === undefined ? undefined : rowId(listId, highlighted)
            }
            aria-controls={listId}
            aria-expanded
            aria-label={PROMPT}
            onChange={(event) => {
              const to = walked({
                directory,
                home: request.home,
                typed: event.target.value,
              });
              setDirectory(to.directory);
              setQuery(to.filter);
              setStepped(undefined);
            }}
            onKeyDown={(event) => {
              const step = stepOf(event);
              const up = parentOf(directory);
              if (step !== undefined) {
                event.preventDefault();
                setStepped(steppedTo(highlighted ?? 0, step, rows.length));
              } else if (
                event.key === "Enter" &&
                !event.ctrlKey &&
                !event.metaKey
              ) {
                event.preventDefault();
                if (current === undefined) {
                  confirm();
                } else {
                  open(current);
                }
              } else if (event.key === "Tab" && multiple) {
                // fzf's mark: this file, and on to the next.
                event.preventDefault();
                if (
                  current?.kind === RowKind.File &&
                  highlighted !== undefined
                ) {
                  setMarks(toggled(marks, current.path));
                  setStepped(steppedTo(highlighted, 1, rows.length));
                }
              } else if (
                event.key === "Backspace" &&
                query === "" &&
                up !== undefined
              ) {
                event.preventDefault();
                go(up);
              } else {
                confirmOnChord(event);
              }
            }}
            placeholder={PLACEHOLDER}
            prefixIcon={<MagnifyingGlassIcon size={ICON_SIZE} />}
            ref={ref}
            role="combobox"
            // File names are not prose.
            spellCheck={false}
            value={query}
          />
          <div className={resultsStyles}>
            <div aria-hidden className={columnsStyles}>
              <span>Name</span>
              <span>Kind</span>
            </div>
            <div
              aria-label={`Contents of ${shownPath(directory, request.home)}`}
              aria-multiselectable={multiple}
              className={listStyles}
              id={listId}
              role="listbox"
            >
              {rows.map((row, at) => {
                const marked = marks.includes(row.path);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox handles the keyboard via `aria-activedescendant`
                  <div
                    // Excludes the kind column.
                    aria-label={row.name}
                    // In multi-select, the marks are the selection; the
                    // highlight is only the cursor.
                    aria-selected={multiple ? marked : at === highlighted}
                    className={rowStyles}
                    data-highlighted={at === highlighted ? "" : undefined}
                    data-marked={marked ? "" : undefined}
                    data-tone={toneOf(row)}
                    id={rowId(listId, at)}
                    key={`${toneOf(row)}:${row.path}`}
                    onClick={() => {
                      pick(row, at);
                    }}
                    onDoubleClick={() => {
                      if (row.kind === RowKind.File) {
                        openFile(row);
                      }
                    }}
                    // Keeps focus in the filter box.
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    ref={at === highlighted ? keepInView : undefined}
                    role="option"
                    tabIndex={-1}
                  >
                    <span className={rowTileStyles} data-row-tile="">
                      <RowGlyph
                        highlighted={at === highlighted}
                        marked={marked}
                        row={row}
                      />
                    </span>
                    <span className={rowNameStyles}>{row.name}</span>
                    <span className={rowKindStyles}>{describe(row)}</span>
                  </div>
                );
              })}
            </div>
            <Emptiness
              listing={listing.state}
              query={query}
              shown={rows.some(({ kind }) => kind !== RowKind.Parent)}
            />
          </div>
          {request.mode === ChooserMode.Save && (
            <Field label="Name">
              <Input
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirm();
                  }
                }}
                spellCheck={false}
                value={name}
              />
            </Field>
          )}
        </section>
        <footer className={footerStyles}>
          <output
            aria-label="Selection"
            className={selectionStyles}
            data-empty={answer === undefined ? "" : undefined}
          >
            <Selection
              answer={answer}
              home={request.home}
              marks={marks}
              mode={request.mode}
            />
          </output>
          <div className={actionsStyles}>
            {request.filters !== undefined && filter !== undefined && (
              <Select
                aria-label="File type"
                onValueChange={(picked) => {
                  if (picked !== null) {
                    setFilter(picked);
                  }
                }}
                options={request.filters.map((group) => ({
                  label: group.name,
                  value: group,
                }))}
                value={filter}
              />
            )}
            <Button onClick={request.cancel} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={answer === undefined}
              onClick={confirm}
              variant="accent"
            >
              {confirmOf(request.mode)}
            </Button>
          </div>
        </footer>
      </div>
    </dialog>
  );
};

// Covers the parent so it cannot be clicked while it waits for an answer. Uses
// the library's glass scrim (see `ModalDialog`) and resets the native
// `dialog` box.
const scrimStyles = css({
  _starting: { opacity: 0 },
  backdropFilter: "blur({spacing.2.5}) saturate(140%)",
  backgroundColor: "color-mix(in oklab, {colors.backdrop} 55%, transparent)",
  blockSize: "auto",
  border: "none",
  color: "foreground",
  display: "grid",
  inlineSize: "auto",
  inset: 0,
  margin: 0,
  maxBlockSize: "none",
  maxInlineSize: "none",
  opacity: 1,
  padding: 4,
  placeItems: "center",
  position: "absolute",
  transition: "opacity {durations.normal} {easings.out}",
});

// The library's glass surface (see `ModalDialog`). Two columns, sidebar and
// folder, with the footer across both.
const panelStyles = grid({
  _before: {
    background:
      "linear-gradient(90deg, transparent, color-mix(in oklab, {colors.foreground} 45%, transparent), transparent)",
    blockSize: "1px",
    content: '""',
    insetBlockStart: 0,
    insetInline: 0,
    position: "absolute",
    zIndex: 1,
  },
  _starting: {
    opacity: 0,
    transform: "translateY({spacing.4}) scale(0.96)",
  },
  "& :has(> [data-control])": {
    backgroundColor:
      "color-mix(in oklab, {colors.background} 45%, transparent)",
  },
  backdropFilter: "blur({spacing.6}) saturate(180%)",
  // More opaque than `ModalDialog`'s glass, for readable rows over anything.
  backgroundColor: "color-mix(in oklab, {colors.card} 86%, transparent)",
  blockSize: "min(86vh, {spacing.180})",
  border: "1px solid color-mix(in oklab, {colors.foreground} 14%, transparent)",
  borderRadius: "2xl",
  boxShadow: "modal",
  gap: 0,
  gridTemplateColumns: "{spacing.60} minmax(0, 1fr)",
  gridTemplateRows: "minmax(0, 1fr) auto",
  inlineSize: "100%",
  maxInlineSize: 256,
  overflow: "hidden",
  position: "relative",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.slow} {easings.outBack}",
});

const sidebarStyles = flex({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  backgroundImage:
    "radial-gradient(120% 60% at 0% 0%, color-mix(in oklab, {colors.accent} 14%, transparent), transparent 70%)",
  borderInlineEnd:
    "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  direction: "column",
  gap: 6,
  minBlockSize: 0,
  overflowY: "auto",
  paddingBlock: 5,
  paddingInline: 4,
});

const brandStyles = hstack({
  gap: 3,
});

const brandTileStyles = css({
  backgroundImage:
    "linear-gradient(160deg, color-mix(in oklab, {colors.accent} 80%, {colors.foreground}), {colors.accent} 60%, color-mix(in oklab, {colors.accent} 70%, {colors.background}))",
  blockSize: 11,
  borderRadius: "lg",
  boxShadow:
    "0 {spacing.2} {spacing.5} color-mix(in oklab, {colors.accent} 40%, transparent), inset 0 1px 0 color-mix(in oklab, {colors.foreground} 35%, transparent)",
  color: "background",
  display: "grid",
  flexShrink: 0,
  inlineSize: 11,
  placeItems: "center",
});

const brandTextStyles = flex({
  direction: "column",
  minInlineSize: 0,
});

const titleStyles = css({
  fontSize: "md",
  fontWeight: "semibold",
  letterSpacing: "tight",
  lineHeight: "tight",
  margin: 0,
});

const subtitleStyles = css({
  color: "muted",
  fontSize: "xs",
});

const placesStyles = flex({
  "& > button": {
    gap: 2.5,
    inlineSize: "100%",
    justifyContent: "flex-start",
  },
  "& > button[aria-current=location]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 18%, transparent)",
    color: "accent",
    fontWeight: "semibold",
  },
  direction: "column",
  gap: 0.5,
});

const sectionLabelStyles = css({
  color: "textTertiary",
  fontSize: "2xs",
  fontWeight: "semibold",
  letterSpacing: "widest",
  marginBlockEnd: 1,
  paddingInline: 2,
  textTransform: "uppercase",
});

const mainStyles = flex({
  direction: "column",
  gap: 3,
  minBlockSize: 0,
  minInlineSize: 0,
  padding: 5,
});

const pathBarStyles = flex({
  "& [aria-current=location]": { color: "foreground", fontWeight: "semibold" },
  alignItems: "center",
  alignSelf: "flex-start",
  backgroundColor: "color-mix(in oklab, {colors.foreground} 5%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  borderRadius: "full",
  color: "muted",
  flexWrap: "wrap",
  maxInlineSize: "100%",
  paddingInline: 1,
  rowGap: 0.5,
});

const crumbStyles = hstack({
  gap: 0,
});

const crumbSeparatorStyles = css({
  color: "textTertiary",
  display: "inline-flex",
  marginInline: 0.5,
});

const resultsStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.background} 30%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 7%, transparent)",
  borderRadius: "xl",
  flex: "1 1 auto",
  minBlockSize: 40,
  overflowY: "auto",
  paddingBlockEnd: 1.5,
  paddingInline: 1.5,
  position: "relative",
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
  scrollPaddingBlockStart: 9,
});

const columnsStyles = grid({
  backdropFilter: "blur({spacing.3})",
  backgroundColor: "color-mix(in oklab, {colors.card} 70%, transparent)",
  color: "textTertiary",
  columnGap: 3,
  fontSize: "2xs",
  fontWeight: "semibold",
  gridTemplateColumns: "minmax(0, 1fr) {spacing.32}",
  insetBlockStart: 0,
  letterSpacing: "widest",
  marginBlockEnd: 1,
  marginInline: -1.5,
  paddingBlock: 2,
  // Matches the rows' insets so headers align with their columns.
  paddingInlineEnd: 3.5,
  paddingInlineStart: 13.5,
  position: "sticky",
  textTransform: "uppercase",
  zIndex: 1,
});

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = grid({
  // The tile color shows the file kind. Tones that blend two hues mix in
  // OKLCH, since OKLab mixing passes through gray.
  "& [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, var(--tone) 16%, transparent)",
    borderColor: "color-mix(in oklab, var(--tone) 26%, transparent)",
    color: "var(--tone)",
  },
  "&[data-highlighted]": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in oklab, {colors.accent} 30%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
  },
  "&[data-highlighted] [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 28%, transparent)",
    borderColor: "color-mix(in oklab, {colors.accent} 45%, transparent)",
    color: "accent",
  },
  "&[data-marked] [data-row-tile]": {
    backgroundColor: "accent",
    borderColor: "accent",
    color: "background",
  },
  "&[data-tone=archive]": { "--tone": "{colors.warning}" },
  "&[data-tone=audio]": {
    "--tone": "color-mix(in oklch, {colors.warning} 50%, {colors.danger})",
  },
  "&[data-tone=code]": { "--tone": "{colors.success}" },
  "&[data-tone=document]": {
    "--tone": "color-mix(in oklab, {colors.accent} 45%, {colors.foreground})",
  },
  "&[data-tone=folder]": { "--tone": "{colors.accent}" },
  "&[data-tone=image]": {
    "--tone": "color-mix(in oklch, {colors.danger} 55%, {colors.accent})",
  },
  "&[data-tone=other]": { "--tone": "{colors.muted}" },
  "&[data-tone=parent]": { "--tone": "{colors.muted}", color: "muted" },
  "&[data-tone=pdf]": { "--tone": "{colors.danger}" },
  "&[data-tone=video]": {
    "--tone": "color-mix(in oklch, {colors.danger} 80%, {colors.warning})",
  },
  alignItems: "center",
  borderRadius: "md",
  color: "foreground",
  columnGap: 3,
  cursor: "pointer",
  gridTemplateColumns: "auto minmax(0, 1fr) {spacing.32}",
  paddingBlock: 1.5,
  paddingInline: 2,
  transition: "background-color {durations.fast} {easings.out}",
  userSelect: "none",
});

const rowTileStyles = css({
  blockSize: 7,
  border: "1px solid transparent",
  borderRadius: "sm",
  display: "grid",
  inlineSize: 7,
  placeItems: "center",
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
});

const rowNameStyles = css({
  fontSize: "sm",
  fontWeight: "medium",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const rowKindStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const placeholderStyles = vstack({
  color: "muted",
  gap: 1.5,
  inset: 0,
  justifyContent: "center",
  padding: 6,
  pointerEvents: "none",
  position: "absolute",
  textAlign: "center",
});

const placeholderGlyphStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 5%, transparent)",
  borderRadius: "full",
  color: "textTertiary",
  display: "inline-flex",
  marginBlockEnd: 2,
  padding: 4,
});

const placeholderTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "semibold",
});

const placeholderNoteStyles = css({
  fontSize: "sm",
});

const footerStyles = hstack({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 3%, transparent)",
  borderBlockStart:
    "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  gap: 4,
  gridColumn: "1 / -1",
  justifyContent: "space-between",
  paddingBlock: 3.5,
  paddingInline: 5,
});

// Drawn as a chip only when there is a selection.
const selectionStyles = hstack({
  "&[data-empty]": {
    backgroundColor: "transparent",
    borderColor: "transparent",
    boxShadow: "none",
    paddingInline: 0,
  },
  backgroundColor: "color-mix(in oklab, {colors.accent} 12%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.accent} 30%, transparent)",
  borderRadius: "full",
  boxShadow:
    "0 0 0 {spacing.1} color-mix(in oklab, {colors.accent} 6%, transparent)",
  flex: "0 1 auto",
  fontSize: "sm",
  gap: 2,
  minInlineSize: 0,
  paddingBlock: 1,
  paddingInline: 3,
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, box-shadow {durations.fast} {easings.out}",
});

const selectionGlyphStyles = css({
  color: "accent",
  display: "inline-flex",
  flexShrink: 0,
});

const selectionCountStyles = css({
  color: "accent",
  flexShrink: 0,
  fontWeight: "semibold",
});

const selectionPathStyles = css({
  display: "flex",
  minInlineSize: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
});

// Truncates before the file name does.
const selectionFolderStyles = css({
  color: "muted",
  flexShrink: 1,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const selectionNameStyles = css({
  flexShrink: 0,
  fontWeight: "semibold",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

const selectionNoneStyles = css({
  color: "muted",
});

const actionsStyles = hstack({
  flexShrink: 0,
  gap: 2,
});

const keysStyles = flex({
  color: "muted",
  direction: "column",
  fontSize: "xs",
  gap: 1.5,
  margin: 0,
  marginBlockStart: "auto",
  paddingInline: 2,
});

const keyStyles = grid({
  alignItems: "center",
  columnGap: 3,
  gridTemplateColumns: "{spacing.16} minmax(0, 1fr)",
});

const keyCapsStyles = hstack({
  gap: 1,
});

const keyWhatStyles = css({
  margin: 0,
});

/** The sidebar icon for the request mode. */
const ModeGlyph = ({ mode }: { mode: ChooserMode }) => {
  switch (mode) {
    case ChooserMode.Open: {
      return <FileArrowUpIcon size={22} weight="fill" />;
    }
    case ChooserMode.OpenMultiple: {
      return <FilesIcon size={22} weight="fill" />;
    }
    case ChooserMode.OpenFolder: {
      return <FolderOpenIcon size={22} weight="fill" />;
    }
    case ChooserMode.Save: {
      return <FloppyDiskIcon size={22} weight="fill" />;
    }
  }
};

/** The icon for the path bar's first crumb: home or root. */
const CrumbGlyph = ({ label }: { label: string }) =>
  label === "~" ? (
    <HouseIcon size={14} weight="fill" />
  ) : (
    <HardDrivesIcon size={14} weight="fill" />
  );

/**
 * A row's icon: a check if marked, else its kind. Filled when highlighted,
 * since an outline icon loses contrast on the highlight, as in the launcher.
 */
const RowGlyph = ({
  highlighted,
  marked,
  row,
}: {
  highlighted: boolean;
  marked: boolean;
  row: Row;
}) => {
  if (marked) {
    return <CheckIcon size={ICON_SIZE} weight="bold" />;
  } else {
    switch (row.kind) {
      case RowKind.Parent: {
        return <ArrowBendLeftUpIcon size={ICON_SIZE} weight="bold" />;
      }
      case RowKind.Directory: {
        return highlighted ? (
          <FolderOpenIcon size={ICON_SIZE} weight="fill" />
        ) : (
          <FolderIcon size={ICON_SIZE} weight="fill" />
        );
      }
      case RowKind.File: {
        const Glyph = glyphOf(fileKindOf(row.name));
        return (
          <Glyph size={ICON_SIZE} weight={highlighted ? "fill" : "duotone"} />
        );
      }
    }
  }
};

/**
 * The empty-state message for an unreadable folder, an empty folder or a
 * filter with no matches. Shows nothing while loading, to avoid a flash.
 */
const Emptiness = ({
  listing,
  query,
  shown,
}: {
  listing: ListingState;
  query: string;
  shown: boolean;
}) => {
  switch (listing) {
    case ListingState.Loading: {
      return undefined;
    }
    case ListingState.Unreadable: {
      return (
        <Placeholder
          glyph={<LockIcon size={PLACEHOLDER_ICON_SIZE} weight="duotone" />}
          note="It isn't there, or it isn't yours to read."
          title="Can't open this folder"
        />
      );
    }
    case ListingState.Listed: {
      if (shown) {
        return undefined;
      } else {
        return query === "" ? (
          <Placeholder
            glyph={
              <FolderOpenIcon size={PLACEHOLDER_ICON_SIZE} weight="duotone" />
            }
            note="Nothing here to pick."
            title="This folder is empty"
          />
        ) : (
          <Placeholder
            glyph={
              <MagnifyingGlassIcon
                size={PLACEHOLDER_ICON_SIZE}
                weight="duotone"
              />
            }
            note="Type a / to go somewhere else."
            title={`Nothing here matches “${query}”`}
          />
        );
      }
    }
  }
};

const Placeholder = ({
  glyph,
  note,
  title,
}: {
  glyph: ReactNode;
  note: string;
  title: string;
}) => (
  <div className={placeholderStyles}>
    <span className={placeholderGlyphStyles}>{glyph}</span>
    <span className={placeholderTitleStyles}>{title}</span>
    <span className={placeholderNoteStyles}>{note}</span>
  </div>
);

/** The footer chip showing what the confirm button would choose. */
const Selection = ({
  answer,
  home,
  marks,
  mode,
}: {
  answer: readonly string[] | undefined;
  home: string;
  marks: readonly string[];
  mode: ChooserMode;
}) => {
  if (answer === undefined) {
    return (
      <span className={selectionNoneStyles}>
        {mode === ChooserMode.Save ? "Name the file" : "Nothing selected"}
      </span>
    );
  } else if (marks.length > 0) {
    return (
      <>
        <span className={selectionCountStyles}>
          {marks.length === 1 ? "1 file" : `${marks.length.toString()} files`}
        </span>
        <span className={selectionFolderStyles}>
          {marks
            .map((path) => path.slice(path.lastIndexOf("/") + 1))
            .join(", ")}
        </span>
      </>
    );
  } else {
    return (
      <>
        <span className={selectionGlyphStyles}>
          {mode === ChooserMode.OpenFolder ? (
            <FolderIcon size={ICON_SIZE} weight="fill" />
          ) : (
            <CheckIcon size={ICON_SIZE} weight="bold" />
          )}
        </span>
        {answer.map((path) => (
          <SelectedPath key={path} path={shownPath(path, home)} />
        ))}
      </>
    );
  }
};

/**
 * A selected path, with the folder dimmed and truncated first so the file
 * name stays visible.
 */
const SelectedPath = ({ path }: { path: string }) => {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span className={selectionPathStyles}>
      <span className={selectionFolderStyles}>{path.slice(0, cut)}</span>
      <span className={selectionNameStyles}>{path.slice(cut)}</span>
    </span>
  );
};

/** The key help at the foot of the sidebar. */
const Keys = ({ mode }: { mode: ChooserMode }) => (
  <dl className={keysStyles}>
    <Key keys={["↑", "↓"]} what="Move" />
    <Key keys={["↵"]} what="Open" />
    <Key keys={["⌫"]} what="Up a folder" />
    {mode === ChooserMode.OpenMultiple && <Key keys={["tab"]} what="Mark" />}
    {(mode === ChooserMode.OpenFolder || mode === ChooserMode.Save) && (
      <Key keys={["ctrl", "↵"]} what={confirmOf(mode)} />
    )}
    <Key keys={["esc"]} what="Cancel" />
  </dl>
);

const Key = ({ keys, what }: { keys: readonly string[]; what: string }) => (
  <div className={keyStyles}>
    <dt className={keyCapsStyles}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </dt>
    <dd className={keyWhatStyles}>{what}</dd>
  </div>
);

/** The sidebar entries: home, the standard folders present, and root. */
const placesOf = (
  home: string,
  entries: readonly string[],
): readonly Place[] => [
  { glyph: HouseIcon, label: "Home", path: home },
  ...STANDARD_PLACES.filter(([label]) => entries.includes(`${label}/`)).map(
    ([label, glyph]) => ({ glyph, label, path: pathIn(home, label) }),
  ),
  { glyph: HardDrivesIcon, label: "Computer", path: "/" },
];

/** The default highlight: the first row below `..`. */
const firstOf = (rows: readonly Row[]): number =>
  rows[0]?.kind === RowKind.Parent && rows.length > 1 ? 1 : 0;

/**
 * The paths the picker would return now, or `undefined` if nothing valid is
 * selected. A folder request returns the current directory; multi-select
 * returns the marks, or the highlighted file if none.
 */
const answerOf = ({
  current,
  directory,
  marks,
  mode,
  name,
}: {
  current: Row | undefined;
  directory: string;
  marks: readonly string[];
  mode: ChooserMode;
  name: string;
}): readonly string[] | undefined => {
  const file = current?.kind === RowKind.File ? [current.path] : undefined;
  switch (mode) {
    case ChooserMode.Open: {
      return file;
    }
    case ChooserMode.OpenMultiple: {
      return marks.length > 0 ? marks : file;
    }
    case ChooserMode.OpenFolder: {
      return [directory];
    }
    case ChooserMode.Save: {
      return name === "" ? undefined : [pathIn(directory, name)];
    }
  }
};

/** `marks` with `path` toggled. */
const toggled = (marks: readonly string[], path: string): readonly string[] =>
  marks.includes(path)
    ? marks.filter((marked) => marked !== path)
    : [...marks, path];

/** The Kind column text for a row. */
const describe = (row: Row): string => {
  switch (row.kind) {
    case RowKind.Parent: {
      return "Up a folder";
    }
    case RowKind.Directory: {
      return "Folder";
    }
    case RowKind.File: {
      return kindLabel(row.name);
    }
  }
};

const glyphOf = (kind: FileKind): typeof FileIcon => {
  switch (kind) {
    case FileKind.Archive: {
      return FileZipIcon;
    }
    case FileKind.Audio: {
      return FileAudioIcon;
    }
    case FileKind.Code: {
      return FileCodeIcon;
    }
    case FileKind.Document: {
      return FileTextIcon;
    }
    case FileKind.Image: {
      return FileImageIcon;
    }
    case FileKind.Pdf: {
      return FilePdfIcon;
    }
    case FileKind.Video: {
      return FileVideoIcon;
    }
    case FileKind.Other: {
      return FileIcon;
    }
  }
};

/** A row's `data-tone`, which sets its tile color. */
const toneOf = (row: Row): string => {
  switch (row.kind) {
    case RowKind.Parent: {
      return "parent";
    }
    case RowKind.Directory: {
      return "folder";
    }
    case RowKind.File: {
      return fileToneOf(fileKindOf(row.name));
    }
  }
};

const fileToneOf = (kind: FileKind): string => {
  switch (kind) {
    case FileKind.Archive: {
      return "archive";
    }
    case FileKind.Audio: {
      return "audio";
    }
    case FileKind.Code: {
      return "code";
    }
    case FileKind.Document: {
      return "document";
    }
    case FileKind.Image: {
      return "image";
    }
    case FileKind.Pdf: {
      return "pdf";
    }
    case FileKind.Video: {
      return "video";
    }
    case FileKind.Other: {
      return "other";
    }
  }
};

const titleOf = (mode: ChooserMode): string => {
  switch (mode) {
    case ChooserMode.Open: {
      return "Open a file";
    }
    case ChooserMode.OpenMultiple: {
      return "Open files";
    }
    case ChooserMode.OpenFolder: {
      return "Choose a folder";
    }
    case ChooserMode.Save: {
      return "Save as";
    }
  }
};

const subtitleOf = (mode: ChooserMode): string => {
  switch (mode) {
    case ChooserMode.Open: {
      return "Pick a file";
    }
    case ChooserMode.OpenMultiple: {
      return "Pick one or more";
    }
    case ChooserMode.OpenFolder: {
      return "Pick a folder";
    }
    case ChooserMode.Save: {
      return "Pick where it goes";
    }
  }
};

const confirmOf = (mode: ChooserMode): string => {
  switch (mode) {
    case ChooserMode.Open:
    case ChooserMode.OpenMultiple: {
      return "Open";
    }
    case ChooserMode.OpenFolder: {
      return "Choose";
    }
    case ChooserMode.Save: {
      return "Save";
    }
  }
};

/** A row's id, for `aria-activedescendant`. */
const rowId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;
