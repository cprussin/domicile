import { Button } from "@domicile/component-library/Button";
import { Field } from "@domicile/component-library/Field";
import { Input } from "@domicile/component-library/Input";
import { Kbd } from "@domicile/component-library/Kbd";
import { ArrowBendLeftUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowBendLeftUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FileAudioIcon } from "@phosphor-icons/react/dist/ssr/FileAudio";
import { FileCodeIcon } from "@phosphor-icons/react/dist/ssr/FileCode";
import { FileImageIcon } from "@phosphor-icons/react/dist/ssr/FileImage";
import { FilePdfIcon } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { FileVideoIcon } from "@phosphor-icons/react/dist/ssr/FileVideo";
import { FileZipIcon } from "@phosphor-icons/react/dist/ssr/FileZip";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr/FolderOpen";
import { HardDrivesIcon } from "@phosphor-icons/react/dist/ssr/HardDrives";
import { HouseIcon } from "@phosphor-icons/react/dist/ssr/House";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useId, useState } from "react";

import { css } from "../../../styled-system/css";
import { flex, hstack, vstack } from "../../../styled-system/patterns";
import {
  highlightIn,
  keepInView,
  stepOf,
  steppedTo,
} from "../../launcher/walk";
import type { FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";
import { pathIn } from "./path-in";
import type { Row } from "./rows";
import { RowKind, rowsIn } from "./rows";
import { ListingState, useListing } from "./useListing";
import { crumbsOf, parentOf, shownPath, walked } from "./walk-path";

/** What the box is for, as its accessible name. */
const PROMPT = "Filter or go to a path";

/** What the box says while it is empty: what typing in it does. */
const PLACEHOLDER = "Filter, or type a path:  /  root   ~  home   ..  up";

/** How big a row's glyph, and the box's, is drawn. */
const ICON_SIZE = 16;

/** File glyphs by extension, lower case: what a name says the file is. */
const GLYPHS: ReadonlyMap<string, typeof FileIcon> = new Map([
  ...["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip", "zst"].map(
    (extension) => [extension, FileZipIcon] as const,
  ),
  ...["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"].map(
    (extension) => [extension, FileAudioIcon] as const,
  ),
  ...[
    "c",
    "cc",
    "css",
    "go",
    "h",
    "html",
    "js",
    "json",
    "nix",
    "py",
    "rs",
    "sh",
    "toml",
    "ts",
    "tsx",
    "yaml",
    "yml",
  ].map((extension) => [extension, FileCodeIcon] as const),
  ...["avif", "bmp", "gif", "heic", "jpeg", "jpg", "png", "svg", "webp"].map(
    (extension) => [extension, FileImageIcon] as const,
  ),
  ...["pdf"].map((extension) => [extension, FilePdfIcon] as const),
  ...["csv", "doc", "docx", "md", "odt", "org", "rtf", "txt"].map(
    (extension) => [extension, FileTextIcon] as const,
  ),
  ...["avi", "m4v", "mkv", "mov", "mp4", "webm"].map(
    (extension) => [extension, FileVideoIcon] as const,
  ),
]);

type Props = {
  /**
   * The box, which is where the window's keyboard goes while the picker is
   * up — see `BrowserWindow`.
   */
  ref?: Ref<HTMLInputElement> | undefined;
  /** What the page is waiting on, and how to answer it. */
  request: FileRequest;
};

/**
 * A file picker for the page in a browser window, drawn over that page.
 *
 * **A FILE SELECTOR, AND THE WHOLE FILESYSTEM.** It opens in the home and
 * walks the tree from there, one directory at a time, each listed by the
 * browser as it is reached: nothing is indexed. `..` heads every directory but
 * the root, and the path bar above jumps back to any directory on the way.
 *
 * **THE BOX IS A PATH.** What is typed narrows the directory listed; a `/`
 * walks — `Scratch/` into Scratch, `../` up, a leading `/` to the root, `~/`
 * home — the way a shell's prompt reads a path. See `walked`.
 *
 * **SELECTING IS NOT CHOOSING.** A click, or the arrows, select a file, and
 * the line above the buttons says which; Enter, a double click or the button
 * chooses it. A directory is somewhere to go, so a click on one goes there.
 *
 * **OVER THE PAGE, NOT THE DESKTOP.** The question is the page's, and a page
 * waiting on a picker is a window that cannot go on until it is answered —
 * every other window can. So it covers the page it belongs to and nothing
 * else, and the address bar above it still works.
 *
 * The keys: the arrows move, Enter opens, Backspace in an empty box goes up,
 * Ctrl+Enter chooses whatever is selected, Escape cancels — and where several
 * files are asked for, Tab marks a file and moves on, fzf's way.
 */
export const FilePicker = ({ ref, request }: Props) => {
  const titleId = useId();
  const listId = useId();
  const [directory, setDirectory] = useState(request.home);
  const [query, setQuery] = useState("");
  // Where the arrows or a click have taken the highlight, or `undefined` for
  // a directory just reached — which starts on its first row below `..`.
  const [stepped, setStepped] = useState<number | undefined>(undefined);
  // The files marked for a choice of several, by path, in the order marked.
  const [marks, setMarks] = useState<readonly string[]>([]);
  const [name, setName] = useState(request.suggestedName);

  const listing = useListing(request.list, directory);
  const rows = rowsIn({
    accept: request.accept,
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

  // Enter on a row, or a double click: a directory is gone into, and a file
  // is chosen — or, for a save, named.
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

  // A single click: a directory is gone into, which is what the `..` and the
  // folders are for under a pointer; a file is selected, and marked or named
  // where the question is one of those.
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

  // Ctrl+Enter, from either field: choose what the selection line says.
  const confirmOnChord = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape is what puts a dialog away wherever in it the focus is — the box, the name, a button — so it is the dialog's key, not one control's
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
        <header className={headerStyles}>
          <h2 className={titleStyles} id={titleId}>
            {titleOf(request.mode)}
          </h2>
          <nav aria-label="Path" className={pathBarStyles}>
            {crumbsOf(directory, request.home).map((crumb, at, crumbs) => (
              <span className={crumbStyles} key={crumb.path}>
                {at > 0 && (
                  <span aria-hidden className={crumbSeparatorStyles}>
                    <CaretRightIcon size={12} />
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
                  size="sm"
                  variant="ghost"
                >
                  {crumb.label}
                </Button>
              </span>
            ))}
          </nav>
        </header>
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
              if (current?.kind === RowKind.File && highlighted !== undefined) {
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
          // File names are not prose — see the launcher's box.
          spellCheck={false}
          value={query}
        />
        <div className={resultsStyles}>
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
                // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox above owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
                <div
                  // Marked, for a choice of several — the highlight is only
                  // where Tab would mark next. Highlighted, for a choice of one.
                  aria-selected={multiple ? marked : at === highlighted}
                  className={rowStyles}
                  data-highlighted={at === highlighted ? "" : undefined}
                  data-kind={kindOf(row.kind)}
                  data-marked={marked ? "" : undefined}
                  id={rowId(listId, at)}
                  key={`${kindOf(row.kind)}:${row.path}`}
                  onClick={() => {
                    pick(row, at);
                  }}
                  onDoubleClick={() => {
                    if (row.kind === RowKind.File) {
                      openFile(row);
                    }
                  }}
                  // A press on a row does not take the focus out of the field
                  // that was being typed in: the keyboard stays where it was.
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
                  {row.kind === RowKind.Directory && (
                    <span aria-hidden className={rowCaretStyles}>
                      <CaretRightIcon size={12} />
                    </span>
                  )}
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
        <Keys mode={request.mode} />
      </div>
    </dialog>
  );
};

/** The path bar's first step: home, or the root. */
const CrumbGlyph = ({ label }: { label: string }) =>
  label === "~" ? (
    <HouseIcon size={ICON_SIZE} weight="duotone" />
  ) : (
    <HardDrivesIcon size={ICON_SIZE} weight="duotone" />
  );

/**
 * The glyph a row starts with: a mark, or what the row is. Filled where the
 * highlight is, because an outline glyph is mostly the ground it is drawn on,
 * and a lit row takes that ground's contrast with it — see the launcher.
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
  const weight = highlighted ? "fill" : "regular";
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
          <FolderIcon size={ICON_SIZE} weight="duotone" />
        );
      }
      case RowKind.File: {
        const Glyph = glyphOf(row.name);
        return <Glyph size={ICON_SIZE} weight={weight} />;
      }
    }
  }
};

/**
 * What the list says when it has no rows of its own to show: a folder that
 * cannot be read, one with nothing in it, or a filter nothing matches. Not
 * while the browser is still reading one — that is a moment, and a message
 * that flashed through it would be noise.
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
          glyph={<LockIcon size={32} weight="duotone" />}
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
            glyph={<FolderOpenIcon size={32} weight="duotone" />}
            note="Nothing here the page can take."
            title="This folder is empty"
          />
        ) : (
          <Placeholder
            glyph={<MagnifyingGlassIcon size={32} weight="duotone" />}
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

/** The line that says what the button would choose. */
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
 * A path as the selection says it: the folder dimmed and giving way first, so
 * the name — what was picked — is the part that is always read.
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

/** The keys the picker answers to, said under it, as the launcher says its. */
const Keys = ({ mode }: { mode: ChooserMode }) => (
  <div className={keysStyles}>
    <span className={keyStyles}>
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd> Move
    </span>
    <span className={keyStyles}>
      <Kbd>↵</Kbd> Open
    </span>
    <span className={keyStyles}>
      <Kbd>⌫</Kbd> Up
    </span>
    {mode === ChooserMode.OpenMultiple && (
      <span className={keyStyles}>
        <Kbd>tab</Kbd> Mark
      </span>
    )}
    {(mode === ChooserMode.OpenFolder || mode === ChooserMode.Save) && (
      <span className={keyStyles}>
        <Kbd>ctrl</Kbd>
        <Kbd>↵</Kbd> {confirmOf(mode)}
      </span>
    )}
    <span className={keyStyles}>
      <Kbd>esc</Kbd> Cancel
    </span>
  </div>
);

/** Where a directory's highlight starts: its first row below `..`. */
const firstOf = (rows: readonly Row[]): number =>
  rows[0]?.kind === RowKind.Parent && rows.length > 1 ? 1 : 0;

/**
 * What the picker would answer now, or `undefined` while it has nothing to
 * answer with: no file selected, or a save with no name. A folder is the one
 * the picker is in; several files are the ones marked, or the selected one
 * when none is.
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

/** `marks` with `path` marked if it was not, and unmarked if it was. */
const toggled = (marks: readonly string[], path: string): readonly string[] =>
  marks.includes(path)
    ? marks.filter((marked) => marked !== path)
    : [...marks, path];

/** The glyph for a file of `name`, by its extension. */
const glyphOf = (name: string): typeof FileIcon => {
  const dot = name.lastIndexOf(".");
  const glyph =
    dot > 0 ? GLYPHS.get(name.slice(dot + 1).toLowerCase()) : undefined;
  // Most files are none of the kinds above, and a page of a plain file glyph
  // is what a file manager draws for them too.
  return glyph ?? FileIcon;
};

/** What `data-kind` says a row is, for its styles. */
const kindOf = (kind: RowKind): string => {
  switch (kind) {
    case RowKind.Parent: {
      return "parent";
    }
    case RowKind.Directory: {
      return "directory";
    }
    case RowKind.File: {
      return "file";
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

/** A row's own id, which is what `aria-activedescendant` points at. */
const rowId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;

// The whole page, dimmed and blurred, and nothing of it reachable: the page is
// waiting on this, and a press that went through to it would be a page
// answering its own question. The library's glass scrim — see `ModalDialog` —
// fading in. A `dialog` of the browser's, so its own box is reset to this one.
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

// A pane of the library's glass — see `ModalDialog`'s glass surface — rising
// into place as it opens: the page behind it comes through blurred and a shade
// richer, and the top edge carries the line of light a pane catches.
const panelStyles = flex({
  _before: {
    background:
      "linear-gradient(90deg, transparent, color-mix(in oklab, {colors.foreground} 40%, transparent), transparent)",
    blockSize: "1px",
    content: '""',
    insetBlockStart: 0,
    insetInline: 0,
    position: "absolute",
  },
  _starting: {
    opacity: 0,
    transform: "translateY({spacing.3}) scale(0.96)",
  },
  // The controls on it are part of the pane rather than cards sitting on it.
  "& :has(> [data-control])": {
    backgroundColor:
      "color-mix(in oklab, {colors.background} 45%, transparent)",
  },
  backdropFilter: "blur({spacing.5}) saturate(180%)",
  // More of the card than `ModalDialog`'s glass lets through: this one is
  // read row by row, over whatever page asked.
  backgroundColor: "color-mix(in oklab, {colors.card} 84%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 16%, transparent)",
  borderRadius: "xl",
  boxShadow: "modal",
  direction: "column",
  gap: 3,
  inlineSize: "100%",
  maxBlockSize: "100%",
  maxInlineSize: 180,
  overflow: "hidden",
  padding: 5,
  position: "relative",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.outQuart}",
});

const headerStyles = flex({
  direction: "column",
  gap: 1,
});

const titleStyles = css({
  fontSize: "lg",
  fontWeight: "semibold",
  margin: 0,
});

// The steps to here, each one somewhere to go back to, the last the one the
// picker is in.
const pathBarStyles = flex({
  "& [aria-current=location]": { color: "foreground", fontWeight: "semibold" },
  alignItems: "center",
  color: "muted",
  flexWrap: "wrap",
  marginInlineStart: -2,
  rowGap: 0.5,
});

const crumbStyles = hstack({
  gap: 0,
});

const crumbSeparatorStyles = css({
  color: "textTertiary",
  display: "inline-flex",
});

// The same height whatever is in it, for the launcher's reason: the rows land
// after the picker is up, and a box that fitted them would resize under the
// hand typing into it. A ground a shade off the card's, so the room it keeps
// reads as a place waiting for rows.
const resultsStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  blockSize: "50vh",
  border: "1px solid color-mix(in oklab, {colors.foreground} 6%, transparent)",
  borderRadius: "lg",
  flexShrink: 1,
  minBlockSize: 40,
  overflowY: "auto",
  padding: 1.5,
  position: "relative",
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
  scrollPaddingBlock: 1.5,
});

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 6%, transparent)",
  },
  // The selected row, in the desktop's accent: a wash that fades across the
  // row, with a bar at its leading edge so it reads at a glance however pale
  // the accent is.
  "&[data-highlighted]": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in oklab, {colors.accent} 30%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
    boxShadow: "inset {spacing.0.75} 0 0 {colors.accent}",
  },
  "&[data-highlighted] [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 28%, transparent)",
    borderColor: "color-mix(in oklab, {colors.accent} 45%, transparent)",
    color: "accent",
  },
  // Folders in the accent at rest too, so the shape of a directory — what is
  // somewhere to go and what is something to take — reads before its names.
  "&[data-kind=directory] [data-row-tile]": {
    color: "color-mix(in oklab, {colors.accent} 75%, {colors.foreground})",
  },
  "&[data-kind=parent]": { color: "muted" },
  // A mark is a choice already made: the tile says so in solid accent.
  "&[data-marked] [data-row-tile]": {
    backgroundColor: "accent",
    borderColor: "accent",
    color: "background",
  },
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  fontSize: "sm",
  gap: 2.5,
  paddingBlock: 1.5,
  paddingInline: 2,
  transition:
    "background-color {durations.fast} {easings.out}, box-shadow {durations.fast} {easings.out}",
  userSelect: "none",
});

// The glyph sits in a tile of its own, as the launcher's does: every row gets
// the same shoulder to start at, and the highlight lights the tile up.
const rowTileStyles = css({
  blockSize: 7,
  border: "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  borderRadius: "sm",
  color: "muted",
  display: "grid",
  flexShrink: 0,
  inlineSize: 7,
  placeItems: "center",
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
});

const rowNameStyles = css({
  flex: "1 1 auto",
  fontSize: "md",
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const rowCaretStyles = css({
  color: "textTertiary",
  display: "inline-flex",
  flexShrink: 0,
});

// A large glyph in the middle of the list, quiet enough to read as an absence,
// over what it is and what to do about it.
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
  color: "textTertiary",
  display: "inline-flex",
  marginBlockEnd: 1,
});

const placeholderTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "medium",
});

const placeholderNoteStyles = css({
  fontSize: "sm",
});

const footerStyles = hstack({
  gap: 4,
  justifyContent: "space-between",
});

// What the button would choose, as a chip: the answer, said before it is
// given. Nothing chosen yet is said plainly, without the chip.
const selectionStyles = hstack({
  "&[data-empty]": {
    backgroundColor: "transparent",
    borderColor: "transparent",
    paddingInline: 0,
  },
  backgroundColor: "color-mix(in oklab, {colors.accent} 12%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.accent} 30%, transparent)",
  borderRadius: "full",
  flex: "0 1 auto",
  fontSize: "sm",
  gap: 2,
  minInlineSize: 0,
  paddingBlock: 1,
  paddingInline: 3,
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}",
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

// The folder gives way first, its ellipsis at its own end.
const selectionFolderStyles = css({
  color: "muted",
  flexShrink: 1,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
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

const keysStyles = hstack({
  color: "muted",
  flexWrap: "wrap",
  fontSize: "xs",
  gap: 4,
  justifyContent: "center",
});

const keyStyles = hstack({
  gap: 1,
});
