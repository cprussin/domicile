import { Button } from "@domicile/component-library/Button";
import { Field } from "@domicile/component-library/Field";
import { Input } from "@domicile/component-library/Input";
import { Kbd } from "@domicile/component-library/Kbd";
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

import { css } from "../../../styled-system/css";
import { flex, grid, hstack, vstack } from "../../../styled-system/patterns";
import {
  highlightIn,
  keepInView,
  stepOf,
  steppedTo,
} from "../../launcher/walk";
import { FileKind, fileKindOf, kindLabel } from "./file-kind";
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

/** How big a placeholder's glyph is drawn: the size of an absence. */
const PLACEHOLDER_ICON_SIZE = 40;

/**
 * The folders a home has by convention, in the order a file manager lists
 * them, and the glyph each is drawn with. The sidebar shows the ones this
 * home has.
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
  /**
   * The box, which is where the window's keyboard goes while the picker is
   * up — see `BrowserWindow`.
   */
  ref?: Ref<HTMLInputElement> | undefined;
  /** What the page is waiting on, and how to answer it. */
  request: FileRequest;
};

/** A place in the sidebar: where it goes, and how it is drawn. */
type Place = { glyph: typeof FolderIcon; label: string; path: string };

/**
 * A file picker for the page in a browser window, drawn over that page.
 *
 * **A FILE SELECTOR, AND THE WHOLE FILESYSTEM.** It opens in the home and
 * walks the tree from there, one directory at a time, each listed by the
 * browser as it is reached: nothing is indexed. `..` heads every directory but
 * the root, the path bar jumps back to any directory on the way, and the
 * sidebar to the places everybody keeps things.
 *
 * **THE BOX IS A PATH.** What is typed narrows the directory listed; a `/`
 * walks — `Scratch/` into Scratch, `../` up, a leading `/` to the root, `~/`
 * home — the way a shell's prompt reads a path. See `walked`.
 *
 * **SELECTING IS NOT CHOOSING.** A click, or the arrows, select a file, and
 * the chip in the footer says which; Enter, a double click or the button
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
  // The home, listed for the sidebar: which of the places everybody keeps
  // things this one has.
  const homeListing = useListing(request.list, request.home);
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

  // Ctrl+Enter, from either field: choose what the selection chip says.
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
        <aside className={sidebarStyles}>
          <div className={brandStyles}>
            <span className={brandTileStyles}>
              <ModeGlyph mode={request.mode} />
            </span>
            <div className={brandTextStyles}>
              <h2 className={titleStyles} id={titleId}>
                {titleOf(request.mode)}
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
            // File names are not prose — see the launcher's box.
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
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox above owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
                  <div
                    // The name, and not the kind beside it: the kind is
                    // what the row looks like, the name is what it is.
                    aria-label={row.name}
                    // Marked, for a choice of several — the highlight is
                    // only where Tab would mark next. Highlighted, for a
                    // choice of one.
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
                    // A press on a row does not take the focus out of the
                    // field that was being typed in.
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

/** The glyph in the sidebar's tile: what the page is asking for. */
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

/** The path bar's first step: home, or the root. */
const CrumbGlyph = ({ label }: { label: string }) =>
  label === "~" ? (
    <HouseIcon size={14} weight="fill" />
  ) : (
    <HardDrivesIcon size={14} weight="fill" />
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
            note="Nothing here the page can take."
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

/** The chip that says what the button would choose. */
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

/** The keys the picker answers to, at the foot of the sidebar. */
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

/**
 * The sidebar's places: home, the standard folders this home has, and the
 * root.
 */
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

/** What the Kind column says for a row. */
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

/** What `data-tone` says a row's tile is colored as. */
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
// richer, and the top edge carries the line of light a pane catches. Two
// columns, a file manager's: the places, and the folder; the footer across
// both.
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
  // The controls on it are part of the pane rather than cards sitting on it.
  "& :has(> [data-control])": {
    backgroundColor:
      "color-mix(in oklab, {colors.background} 45%, transparent)",
  },
  backdropFilter: "blur({spacing.6}) saturate(180%)",
  // More of the card than `ModalDialog`'s glass lets through: this one is
  // read row by row, over whatever page asked.
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

// The places, on a ground a shade apart from the folder's, with the light
// falling from its top corner.
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

// The mode's glyph on a tile of the accent, lit from above.
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

// Each place a row the width of the sidebar, the one the picker is in lit in
// the accent.
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

// The steps to here as a pill, each one somewhere to go back to, the last the
// one the picker is in.
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

// The folder, filling what the pane has left. A ground a shade off the
// pane's, so the room it keeps reads as a place waiting for rows.
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

// The columns' names, staying put as the rows scroll under them.
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
  // The rows' own insets, so each name sits under its column's: the list's
  // padding and the row's, and the tile and the gap after it.
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
  // THE TILE'S COLOR SAYS WHAT A FILE IS before its name is read: folders in
  // the accent, documents a quieter shade of it, PDFs in red, archives in
  // amber, code in green — the semantic colors, mixed. Mixed in OKLCH where
  // two hues meet, because OKLab's straight line between them runs through
  // gray.
  "& [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, var(--tone) 16%, transparent)",
    borderColor: "color-mix(in oklab, var(--tone) 26%, transparent)",
    color: "var(--tone)",
  },
  // The selected row in the desktop's accent, as the launcher draws its own:
  // a wash that fades across the row.
  "&[data-highlighted]": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in oklab, {colors.accent} 30%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
  },
  // Its tile lit in the accent, whatever the file's own color, as the
  // launcher lights a reached row's.
  "&[data-highlighted] [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 28%, transparent)",
    borderColor: "color-mix(in oklab, {colors.accent} 45%, transparent)",
    color: "accent",
  },
  // A mark is a choice already made: the tile says so in solid accent.
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

// The glyph sits in a tile of its own, as the launcher's does: every row gets
// the same shoulder to start at, and the tile carries the file's color.
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

// A large glyph in the middle of the folder, quiet enough to read as an
// absence, over what it is and what to do about it.
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

// Across both columns, on its own ground: what will be chosen, and the
// buttons that choose it.
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

// What the button would choose, as a chip: the answer, said before it is
// given. Nothing chosen yet is said plainly, without the chip.
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

// The folder gives way first, its ellipsis at its own end.
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

// The keys, at the foot of the sidebar, each a line: what to press, then what
// it does.
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
