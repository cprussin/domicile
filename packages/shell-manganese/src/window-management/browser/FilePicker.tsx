import type { FoundFilesMessage } from "@domicile/chrome-sdk/host-message";
import { Button } from "@domicile/component-library/Button";
import { Field } from "@domicile/component-library/Field";
import { Input } from "@domicile/component-library/Input";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { HouseIcon } from "@phosphor-icons/react/dist/ssr/House";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import type { KeyboardEvent, Ref } from "react";
import { useId, useState } from "react";

import { css } from "../../../styled-system/css";
import { flex, hstack } from "../../../styled-system/patterns";
import type { FileRow } from "../../launcher/file-row";
import { useFound } from "../../launcher/useFound";
import {
  highlightIn,
  keepInView,
  stepOf,
  steppedTo,
} from "../../launcher/walk";
import type { FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";
import { HOME, pickable } from "./pickable";
import { savedPath } from "./saved-path";

/** What the box asks for, as its placeholder and as its accessible name. */
const PROMPT = "Search your files";

/** How big the glyph beside a row, and in the box, is drawn. */
const ICON_SIZE = 16;

type Props = {
  /**
   * The search box, which is where the window's keyboard goes while the
   * picker is up — see `BrowserWindow`.
   */
  ref?: Ref<HTMLInputElement> | undefined;
  /** What the page is waiting on, and how to answer it. */
  request: FileRequest;
  /**
   * What in the home matches a query, answered by the host — the launcher's
   * search, so a picker finds what the launcher finds.
   */
  search: (query: string) => Promise<FoundFilesMessage>;
};

/**
 * A file picker for the page in a browser window, drawn over that page.
 *
 * **THE LAUNCHER'S SEARCH, NOT A FILE MANAGER.** The host indexes the home and
 * answers a query with the paths that match, and those are already the
 * vocabulary the engine takes an answer in — so a picker is a box, the rows
 * the host found, and the narrowing to what the page asked for. There is no
 * tree to walk: a home is found by typing, the way the launcher opens a file.
 *
 * **OVER THE PAGE, NOT THE DESKTOP.** The question is the page's, and a page
 * waiting on a picker is a window that cannot go on until it is answered —
 * every other window can. So it covers the page it belongs to and nothing
 * else, and the address bar above it still works.
 *
 * The keys are the launcher's, and fzf's before it: the arrows walk the rows,
 * Enter takes the one highlighted, and — where several files are asked for —
 * Tab marks a row and moves on, and Enter takes everything marked. Escape
 * cancels.
 */
export const FilePicker = ({ ref, request, search }: Props) => {
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  // Where the arrow keys or the pointer have taken the highlight, from the
  // first row — see `highlightIn`, which keeps it inside a list that has
  // narrowed since.
  const [stepped, setStepped] = useState(0);
  // The rows marked for a choice of several, by path, in the order marked.
  const [marks, setMarks] = useState<readonly string[]>([]);
  const [name, setName] = useState(request.suggestedName);

  const found = useFound(search, query);
  const rows = pickable({
    accept: request.accept,
    found: found.files,
    mode: request.mode,
    query,
  });
  const highlighted = highlightIn(rows.length, stepped);
  const current = highlighted === undefined ? undefined : rows[highlighted];
  const multiple = request.mode === ChooserMode.OpenMultiple;
  const answer = answerOf(request.mode, current, marks, name);

  const confirm = () => {
    if (answer !== undefined) {
      request.choose(answer);
    }
  };

  // What a click on a row does, which is what Enter on it would — except
  // where Enter takes more than the row: a mark, for a choice of several, and
  // the directory to save in, which is half of a save and not all of it.
  const pick = (row: FileRow, at: number) => {
    switch (request.mode) {
      case ChooserMode.Open:
      case ChooserMode.OpenFolder: {
        request.choose([row.path]);
        break;
      }
      case ChooserMode.OpenMultiple: {
        setMarks(toggled(marks, row.path));
        break;
      }
      case ChooserMode.Save: {
        setStepped(at);
        break;
      }
    }
  };

  // Enter, from either field: the box or the name.
  const confirmOnEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
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
        <h2 className={titleStyles} id={titleId}>
          {titleOf(request.mode)}
        </h2>
        <Input
          aria-activedescendant={
            highlighted === undefined ? undefined : rowId(listId, highlighted)
          }
          aria-controls={listId}
          aria-expanded
          aria-label={PROMPT}
          onChange={(event) => {
            setQuery(event.target.value);
            // The walk belongs to the list that was on screen when it
            // happened — see the launcher's box.
            setStepped(0);
          }}
          onKeyDown={(event) => {
            const step = stepOf(event);
            if (step !== undefined) {
              event.preventDefault();
              setStepped(steppedTo(highlighted ?? 0, step, rows.length));
            } else if (event.key === "Tab" && multiple) {
              // fzf's mark: this row, and on to the next.
              event.preventDefault();
              if (current !== undefined && highlighted !== undefined) {
                setMarks(toggled(marks, current.path));
                setStepped(steppedTo(highlighted, 1, rows.length));
              }
            } else {
              confirmOnEnter(event);
            }
          }}
          placeholder={PROMPT}
          prefixIcon={<MagnifyingGlassIcon size={ICON_SIZE} />}
          ref={ref}
          role="combobox"
          // File names are not prose — see the launcher's box.
          spellCheck={false}
          value={query}
        />
        <div className={resultsStyles}>
          <div
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
                  id={rowId(listId, at)}
                  key={row.path}
                  onClick={() => {
                    pick(row, at);
                  }}
                  // A press on a row does not take the focus out of the field
                  // that was being typed in: the keyboard stays where it was.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onPointerMove={() => {
                    setStepped(at);
                  }}
                  ref={at === highlighted ? keepInView : undefined}
                  role="option"
                  tabIndex={-1}
                >
                  <span className={rowGlyphStyles} data-row-glyph="">
                    <RowGlyph marked={marked} row={row} />
                  </span>
                  <span className={rowTextStyles}>
                    {row.directory !== undefined && (
                      <span className={rowDirectoryStyles}>
                        {row.directory}
                      </span>
                    )}
                    <span className={rowNameStyles}>{row.name}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {request.mode === ChooserMode.Save && (
          <Field label="Name">
            <Input
              onChange={(event) => {
                setName(event.target.value);
              }}
              onKeyDown={confirmOnEnter}
              spellCheck={false}
              value={name}
            />
          </Field>
        )}
        <div className={actionsStyles}>
          <Button onClick={request.cancel} variant="ghost">
            Cancel
          </Button>
          <Button disabled={answer === undefined} onClick={confirm}>
            {confirmOf(request.mode)}
          </Button>
        </div>
      </div>
    </dialog>
  );
};

/** The glyph a row starts with: a mark, or what kind of path it is. */
const RowGlyph = ({ marked, row }: { marked: boolean; row: FileRow }) => {
  if (marked) {
    return <CheckIcon size={ICON_SIZE} weight="bold" />;
  } else if (row === HOME) {
    return <HouseIcon size={ICON_SIZE} />;
  } else {
    return row.isDirectory ? (
      <FolderIcon size={ICON_SIZE} />
    ) : (
      <FileIcon size={ICON_SIZE} />
    );
  }
};

/**
 * What the picker would answer now, or `undefined` while it has nothing to
 * answer with — no row, or a save with no name.
 *
 * Several files are the ones marked, or the highlighted one when none is: a
 * choice of several is still allowed to be a choice of one without a mark.
 */
const answerOf = (
  mode: ChooserMode,
  current: FileRow | undefined,
  marks: readonly string[],
  name: string,
): readonly string[] | undefined => {
  switch (mode) {
    case ChooserMode.Open:
    case ChooserMode.OpenFolder: {
      return current === undefined ? undefined : [current.path];
    }
    case ChooserMode.OpenMultiple: {
      if (marks.length > 0) {
        return marks;
      } else {
        return current === undefined ? undefined : [current.path];
      }
    }
    case ChooserMode.Save: {
      return current === undefined || name === ""
        ? undefined
        : [savedPath(current.path, name)];
    }
  }
};

/** `marks` with `path` marked if it was not, and unmarked if it was. */
const toggled = (marks: readonly string[], path: string): readonly string[] =>
  marks.includes(path)
    ? marks.filter((marked) => marked !== path)
    : [...marks, path];

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

// The whole page, dimmed, and nothing of it reachable: the page is waiting on
// this, and a press that went through to it would be a page answering its own
// question. A `dialog` of the browser's, so its own box is reset to this one.
const scrimStyles = css({
  backgroundColor: "backdrop",
  blockSize: "auto",
  border: "none",
  color: "foreground",
  display: "grid",
  inlineSize: "auto",
  inset: 0,
  margin: 0,
  maxBlockSize: "none",
  maxInlineSize: "none",
  padding: 4,
  placeItems: "center",
  position: "absolute",
});

const panelStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "lifted",
  direction: "column",
  gap: 3,
  inlineSize: "100%",
  maxBlockSize: "100%",
  maxInlineSize: 150,
  padding: 4,
});

const titleStyles = css({
  fontSize: "md",
  fontWeight: "semibold",
  margin: 0,
});

// The same height whatever is in it, for the launcher's reason: the rows land
// after the picker is up, and a box that fitted them would resize under the
// hand typing into it.
const resultsStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  blockSize: 80,
  borderRadius: "md",
  flexShrink: 1,
  minBlockSize: 0,
  overflowY: "auto",
  padding: 1,
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
  scrollPaddingBlock: 1,
});

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = hstack({
  "&[aria-selected=true] [data-row-glyph]": { color: "accent" },
  // The highlight in the desktop's accent, as the launcher draws it.
  "&[data-highlighted]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
  },
  borderRadius: "md",
  cursor: "pointer",
  fontSize: "sm",
  gap: 2.5,
  paddingBlock: 1.5,
  paddingInline: 2,
});

const rowGlyphStyles = css({
  color: "muted",
  display: "inline-flex",
  flexShrink: 0,
});

// The directory over the name, each giving way at its own end — see the
// launcher's rows.
const rowTextStyles = flex({
  direction: "column",
  flex: "1 1 auto",
  minInlineSize: 0,
});

const rowNameStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const rowDirectoryStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const actionsStyles = hstack({
  gap: 2,
  justifyContent: "flex-end",
});
