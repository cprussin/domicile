import { FilePreviewKind } from "@domicile/chrome-sdk/file-preview";
import type {
  FilePreviewMessage,
  FoundFilesMessage,
} from "@domicile/chrome-sdk/host-message";
import { Input } from "@domicile/component-library/Input";
import { Kbd } from "@domicile/component-library/Kbd";
import { ModalDialog } from "@domicile/component-library/ModalDialog";
import { BinaryIcon } from "@phosphor-icons/react/dist/ssr/Binary";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr/CircleNotch";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FileXIcon } from "@phosphor-icons/react/dist/ssr/FileX";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { FolderDashedIcon } from "@phosphor-icons/react/dist/ssr/FolderDashed";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import type { ReactNode } from "react";
import { Fragment, useId, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack, vstack } from "../../styled-system/patterns";
import type { Choice } from "./choices";
import { ChoiceKind, choicesFor, launchOf } from "./choices";
import type { FileRow } from "./file-row";
import type { Launch } from "./launch";
import type { Mark } from "./marked";
import { marked } from "./marked";
import { homeUrl, MediaKind, mediaOf } from "./media";
import { useFound } from "./useFound";
import { usePreview } from "./usePreview";
import { useSettled } from "./useSettled";

/** What the box asks for, as its placeholder and as its accessible name. */
const PROMPT = "Open a file, a URL, or search";

/**
 * How long the highlight has to stay on a row before it is previewed: long
 * enough that typing a name is not a preview per letter, short enough that
 * stopping on a row is not waiting for one.
 */
const PREVIEW_SETTLE_MS = 200;

/** How big the glyph for a pane with no picture of its own is drawn. */
const EMPTY_ICON_SIZE = 64;

/** How big the glyph beside a row, and in the box, is drawn. */
const ICON_SIZE = 16;

type Props = {
  /**
   * Whether the keyboard is on this page's monitor. A desk of several monitors
   * is several pages, all told the launcher is up: the panel goes on the one
   * the keyboard is on, and the rest draw only the backdrop it is up over.
   */
  here: boolean;
  /** Escape, or a click on the backdrop. The desktop decides what that means. */
  onDismiss: () => void;
  onLaunch: (launch: Launch) => void;
  open: boolean;
  /** What a path holds, answered by the host, for the preview. */
  preview: Preview;
  /**
   * What in the home matches a query, answered by the host.
   *
   * The host searches and the panel draws: the compositor's index is the whole
   * home, and all a page is ever told is what one query found in it.
   */
  search: Search;
};

/** How the panel asks what matches what is in its box. */
type Search = (query: string) => Promise<FoundFilesMessage>;

/** How the panel asks what the highlighted file holds. */
type Preview = (path: string) => Promise<FilePreviewMessage>;

/**
 * One box, over a backdrop, that opens a file, a URL or a search.
 *
 * `mod+space` is what puts it up. What goes in is a query rather than a
 * command — there is nothing to choose between first — and which of the three
 * things it means is `launch.ts`'s to decide, on evidence rather than on a
 * prefix the user has to remember.
 *
 * **It does not close itself.** Whether the launcher is open is desktop state,
 * kept in the same reduction as everything else the keys do, so Escape and a
 * click on the backdrop are reported rather than acted on. A panel that closed
 * itself would be a second copy of that state, and the two would part company
 * the first time `mod+space` was pressed over one the desktop thought was
 * shut.
 */
export const Launcher = ({
  here,
  onDismiss,
  onLaunch,
  open,
  preview,
  search,
}: Props) => (
  <ModalDialog
    // Escape and the backdrop are what put it away, and the footer says the
    // first of those — a corner ✕ on a panel driven from the keyboard is a
    // button nobody aims at and a line of chrome over the thing being read.
    closeButton={false}
    footer={<Keys />}
    onOpenChange={(next) => {
      if (!next) {
        onDismiss();
      }
    }}
    open={open}
    // Where a launcher has always been, and where it covers least of the
    // desktop it is opening something onto.
    placement="top"
    popup={here}
    // Wide, because a row is a name and the directory it is in, and beside
    // the rows is a preview of the one the highlight is on.
    size="xl"
    // A pane rather than a card, because there is a desktop behind it worth
    // keeping: a launcher is a thing held up over your work for a second and
    // a half, and one that blanked what it was over would read as a page the
    // desktop had navigated to.
    surface="glass"
    title="Open"
  >
    {/*
      Inside the dialog, so it is unmounted with it: base-ui portals the popup
      only while it is open, which is what makes every open start on an empty
      box and a full list without an effect anywhere to clear them.
    */}
    <Query onLaunch={onLaunch} preview={preview} search={search} />
  </ModalDialog>
);

type QueryProps = {
  onLaunch: (launch: Launch) => void;
  preview: Preview;
  search: Search;
};

/**
 * The box and the list under it, with the keyboard that moves between them.
 *
 * A combobox over a listbox rather than a box beside some buttons: the rows
 * are one choice among many and the keyboard never leaves the box, which is
 * what `aria-activedescendant` is for. It is also what the interaction
 * actually is — a person types, watches the list narrow, and presses Enter
 * without having looked at the screen for the last two of those.
 */
const Query = ({ onLaunch, preview, search }: QueryProps) => {
  const listId = useId();
  const [query, setQuery] = useState("");
  // Where the arrow keys have walked to, and `undefined` for a list nobody has
  // walked. Not the highlight itself — see `highlightIn`, which is what turns
  // "nobody has walked it" into "the first row, because they typed".
  const [stepped, setStepped] = useState<number | undefined>(undefined);

  const found = useFound(search, query);
  // Every row is a thing Enter can do — the files, and a site and a search
  // around them — so the list is the whole answer to what it will do.
  const choices = choicesFor(query, found.files);
  const highlighted = highlightIn(choices.length, query, stepped);
  const chosen = highlighted === undefined ? undefined : choices[highlighted];
  // Keyed rather than the choice itself, because a choice is a new object on
  // every render and would never be seen to settle.
  const chosenKey = chosen === undefined ? undefined : keyOf(chosen);
  const settledKey = useSettled(chosenKey, PREVIEW_SETTLE_MS);

  return (
    <div className={panelStyles}>
      <Input
        aria-activedescendant={
          highlighted === undefined ? undefined : rowId(listId, highlighted)
        }
        aria-controls={listId}
        aria-expanded
        // Named as well as placeheld, because it is no longer the only
        // combobox a desktop can have on screen: a browser window's address
        // bar is one too, and a placeholder is not an accessible name — it is
        // gone the moment anything is typed.
        aria-label={PROMPT}
        // The box is why the panel is up, and a launcher you have to click
        // into is a launcher that costs more than the terminal it replaces.
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
          // The walk belongs to the list that was on screen when it happened.
          // A narrower list would otherwise keep an index into the old one,
          // which is a highlight on a row nobody chose.
          setStepped(undefined);
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown": {
              // Taken from the box, which would otherwise put the caret at the
              // end of the query on the way past.
              event.preventDefault();
              setStepped(steppedTo(highlighted, 1, choices.length));
              break;
            }
            case "ArrowUp": {
              event.preventDefault();
              setStepped(steppedTo(highlighted, -1, choices.length));
              break;
            }
            case "Enter": {
              // Nothing highlighted is an empty box, which is Enter on a
              // keystroke nobody meant as a command.
              if (chosen !== undefined) {
                onLaunch(launchOf(chosen));
              }
              break;
            }
          }
        }}
        placeholder={PROMPT}
        // The glyph the whole panel is about, at the head of the one thing in
        // it that takes typing.
        prefixIcon={<MagnifyingGlassIcon size={ICON_SIZE} />}
        role="combobox"
        size="lg"
        // A home full of file names is not prose, and a list of them underlined
        // in red reads as a panel full of mistakes.
        spellCheck={false}
        // How much of the home is still answering, in the field doing the
        // narrowing — a find bar's counter, and the one number that says
        // whether one more letter is worth typing.
        suffixIcon={
          <span aria-hidden="true" className={countStyles}>
            {`${found.matched.toString()} matched`}
          </span>
        }
        value={query}
      />
      <div className={splitStyles}>
        {/*
          THE SAME SIZE WHATEVER IS IN IT. The rows are filtered on every
          keystroke and the host's answer lands after the panel is already up,
          so a box that fitted its contents would resize under the hand typing
          into it — a panel that grew and shrank between one letter and the
          next, taking everything below the rows with it.
        */}
        <div className={resultsStyles}>
          {/*
            A listbox of options rather than a list of buttons: the rows are
            one choice among many and the keyboard that walks them never leaves
            the box above, which is what `aria-activedescendant` says. Two
            hundred buttons would say there are two hundred things to press.

            Divs rather than `ul`/`li` because an `li` is non-interactive
            markup and an option is not — the roles are the structure here, and
            doubling them up with list elements is what the lint is objecting
            to.
          */}
          <div className={listStyles} id={listId} role="listbox">
            {choices.map((choice, at) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox above owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
              <div
                aria-selected={at === highlighted}
                className={rowStyles}
                data-highlighted={at === highlighted ? "" : undefined}
                id={rowId(listId, at)}
                key={keyOf(choice)}
                onClick={() => {
                  onLaunch(launchOf(choice));
                }}
                // Only the highlighted row carries it, and it is the same
                // function every render, so React calls it exactly when the
                // highlight arrives at a row rather than on every keystroke.
                ref={at === highlighted ? keepInView : undefined}
                role="option"
                // Reachable programmatically and never in the tab ring: focus
                // stays in the box, which is what makes typing and choosing
                // one gesture rather than two.
                tabIndex={-1}
              >
                <ChoiceRow choice={choice} query={query} />
              </div>
            ))}
          </div>
        </div>
        <section aria-label="Preview" className={previewStyles}>
          <PreviewOf
            choice={chosen}
            preview={preview}
            settled={chosenKey === settledKey}
          />
        </section>
      </div>
      {/*
        Under the rows rather than among them, because it is about the list
        rather than about any row in it — and the rows above are a box of one
        size, so a line that appears and vanishes here moves nothing a person
        is reading.
      */}
      {found.indexing && <StillIndexing />}
    </div>
  );
};

/** What one row says, by the kind of thing Enter on it would do. */
const ChoiceRow = ({ choice, query }: { choice: Choice; query: string }) => {
  switch (choice.kind) {
    case ChoiceKind.File: {
      return <FileChoice query={query} row={choice.row} />;
    }
    case ChoiceKind.Site: {
      return (
        <>
          <RowTile icon={GlobeSimpleIcon} />
          <span className={rowNameStyles}>
            <span className={rowVerbStyles}>Go to</span> {choice.url}
          </span>
        </>
      );
    }
    case ChoiceKind.Search: {
      return (
        <>
          <RowTile icon={MagnifyingGlassIcon} />
          <span className={rowNameStyles}>
            <span className={rowVerbStyles}>Search for</span> {choice.query}
          </span>
        </>
      );
    }
  }
};

/** A path's row: the directory it is in, over its name. */
const FileChoice = ({ query, row }: { query: string; row: FileRow }) => (
  <>
    <RowTile icon={row.isDirectory ? FolderIcon : FileIcon} />
    <span className={rowTextStyles}>
      {row.directory !== undefined && (
        <span className={rowDirectoryStyles}>
          <Marked marks={marked(row.directory, query)} />
        </span>
      )}
      <span className={rowNameStyles}>
        <Marked marks={marked(row.name, query)} />
      </span>
    </span>
  </>
);

/**
 * The glyph a row starts with, in a tile of its own.
 *
 * Drawn twice and one of them shown, because a weight is a different set of
 * paths rather than a color: an outline Phosphor glyph is filled shapes with
 * holes in them, so nothing in CSS can thicken one. The pair is what the
 * component library does for its own icon swap — see
 * `_control/PrefixIconStack` — and it costs the row a second `<svg>` that is
 * never laid out on its own.
 */
const RowTile = ({ icon: Icon }: { icon: typeof FileIcon }) => (
  <span className={rowTileStyles} data-row-tile="">
    <span className={rowGlyphStyles} data-row-glyph="resting">
      <Icon size={ICON_SIZE} />
    </span>
    <span className={rowGlyphStyles} data-row-glyph="reached">
      <Icon size={ICON_SIZE} weight="fill" />
    </span>
  </span>
);

/**
 * What the pane shows, which is never nothing: a blank pane reads as a broken
 * one. With no row highlighted it says how to choose one, and while the typing
 * has not settled it names the row it is about to preview.
 */
const PreviewOf = ({
  choice,
  preview,
  settled,
}: {
  choice: Choice | undefined;
  preview: Preview;
  settled: boolean;
}) => {
  if (choice === undefined) {
    return (
      <Placeholder
        icon={MagnifyingGlassIcon}
        note="Type to find a file, a site or a search"
        title="Nothing selected"
      />
    );
  } else {
    return settled ? (
      <ChoicePreview choice={choice} preview={preview} />
    ) : (
      <Pending choice={choice} />
    );
  }
};

/** The row a preview is on its way for, named and drawn as its kind. */
const Pending = ({ choice }: { choice: Choice }) => {
  switch (choice.kind) {
    case ChoiceKind.File: {
      return <NamedFile row={choice.row} />;
    }
    case ChoiceKind.Site: {
      return <Placeholder icon={GlobeSimpleIcon} title={choice.url} />;
    }
    case ChoiceKind.Search: {
      return (
        <Placeholder
          icon={MagnifyingGlassIcon}
          note="Search"
          title={choice.query}
        />
      );
    }
  }
};

/** A file by name and kind alone, with `note` saying why that is all. */
const NamedFile = ({ note, row }: { note?: string; row: FileRow }) => (
  <Placeholder
    icon={row.isDirectory ? FolderIcon : FileIcon}
    note={note}
    title={row.name}
  />
);

/** A large glyph over a title and a quieter line: a pane with no picture. */
const Placeholder = ({
  icon: Icon,
  note,
  title,
}: {
  icon: typeof FileIcon;
  note?: ReactNode;
  title: string;
}) => (
  <div className={placeholderStyles}>
    <Icon size={EMPTY_ICON_SIZE} weight="thin" />
    <span className={placeholderTitleStyles}>{title}</span>
    {note !== undefined && (
      <span className={placeholderNoteStyles}>{note}</span>
    )}
  </div>
);

/**
 * What the highlighted row is: a file's front, the file itself, or the page a
 * URL is.
 *
 * A site in a `<webview>` of its own, which the pointer passes through: a
 * click in it would take the keyboard into the page, and the keyboard belongs
 * to the box. A file the engine can draw — an image, a video, a PDF — is drawn
 * from `domicile://home/`; anything else is what the host reads of it.
 */
const ChoicePreview = ({
  choice,
  preview,
}: {
  choice: Choice;
  preview: Preview;
}) => {
  switch (choice.kind) {
    case ChoiceKind.File: {
      const media = mediaIn(choice.row);
      // Keyed on the path, so what one row learned — an image that would not
      // load — is not carried onto the next.
      return media === undefined ? (
        <FilePreviewPane preview={preview} row={choice.row} />
      ) : (
        <MediaPreview key={choice.row.path} kind={media} row={choice.row} />
      );
    }
    case ChoiceKind.Site:
    case ChoiceKind.Search: {
      return (
        <webview className={viewStyles} src={choice.url} title={choice.url} />
      );
    }
  }
};

/**
 * A file drawn as itself, from where the engine serves the home — or, when
 * the engine could not draw it after all, named as one it cannot. An extension
 * is a guess, and a broken image is a blank pane.
 */
const MediaPreview = ({ kind, row }: { kind: MediaKind; row: FileRow }) => {
  const [failed, setFailed] = useState(false);
  const url = homeUrl(row.path);
  const fail = () => {
    setFailed(true);
  };
  if (failed) {
    return <CannotPreview row={row} />;
  } else {
    switch (kind) {
      case MediaKind.Image: {
        return (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: `error` is the image failing to load, not something a person does to it
          <img
            alt={row.name}
            className={mediaStyles}
            onError={fail}
            src={url}
          />
        );
      }
      case MediaKind.Video: {
        // Muted, because a preview that starts talking is not a preview.
        return (
          <video
            autoPlay
            className={mediaStyles}
            loop
            muted
            onError={fail}
            src={url}
          >
            <track kind="captions" />
          </video>
        );
      }
      case MediaKind.Audio: {
        return (
          <Placeholder
            icon={FileIcon}
            note={
              <audio controls onError={fail} src={url}>
                <track kind="captions" />
              </audio>
            }
            title={row.name}
          />
        );
      }
      case MediaKind.Pdf: {
        return <iframe className={viewStyles} src={url} title={row.name} />;
      }
    }
  }
};

/** A file whose kind nothing here can draw, by name. */
const CannotPreview = ({ row }: { row: FileRow }) => (
  <Placeholder
    icon={BinaryIcon}
    note="No preview for this file"
    title={row.name}
  />
);

/**
 * What kind of element `row` is drawn in, or `undefined` for one the host
 * reads. Only under home, which is all the engine serves, and never a
 * directory, whatever its name ends in.
 */
const mediaIn = (row: FileRow): MediaKind | undefined =>
  row.isDirectory || row.path.startsWith("/") ? undefined : mediaOf(row.path);

/** What the host says a path holds, drawn by kind. */
const FilePreviewPane = ({
  preview,
  row,
}: {
  preview: Preview;
  row: FileRow;
}) => {
  const shown = usePreview(preview, row.path);
  switch (shown?.kind) {
    // The host has not answered yet, and a desktop with no index never will:
    // either way the row is known, so it is what the pane says.
    case undefined: {
      return <NamedFile row={row} />;
    }
    case FilePreviewKind.Text: {
      return <pre className={textPreviewStyles}>{shown.text}</pre>;
    }
    case FilePreviewKind.Directory: {
      // An empty list is an answer, and a blank pane would read as one still
      // on its way.
      return shown.entries.length === 0 ? (
        <Placeholder
          icon={FolderDashedIcon}
          note="Empty folder"
          title={row.name}
        />
      ) : (
        <ul className={entriesStyles}>
          {shown.entries.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      );
    }
    case FilePreviewKind.Binary: {
      return <CannotPreview row={row} />;
    }
    case FilePreviewKind.Unreadable: {
      return (
        <Placeholder
          icon={FileXIcon}
          note="This file can't be read"
          title={row.name}
        />
      );
    }
  }
};

/**
 * A row's text with the letters the query is responsible for lit.
 *
 * `mark` rather than a styled span, because that is what the element is for
 * and because it is the one piece of this the browser's own find-in-page and
 * a screen reader already understand. It leaves the text alone — the run it
 * wraps is the run it was given — so what a row *says* is what it said
 * before anybody typed.
 */
const Marked = ({ marks }: { marks: readonly Mark[] }) => (
  <>
    {marks.map((mark, at) =>
      mark.matched ? (
        // Index as the key because that is what a run is: the third piece of
        // this name, which is a different piece the moment the query changes.
        <mark className={markStyles} key={at}>
          {mark.text}
        </mark>
      ) : (
        <Fragment key={at}>{mark.text}</Fragment>
      ),
    )}
  </>
);

/**
 * The line that says the list is not all of the home yet.
 *
 * `role="status"` so it is announced rather than only drawn: a person driving
 * this from the keyboard with a screen reader is the person least able to
 * notice rows arriving on their own.
 */
const StillIndexing = () => (
  <p className={indexingStyles} role="status">
    <span className={spinnerStyles}>
      <CircleNotchIcon size={ICON_SIZE} />
    </span>
    Still finding your files
  </p>
);

/**
 * The three keys the panel answers, spelled out under it.
 *
 * A launcher is a keyboard instrument, and the whole of its interface is keys
 * nothing on screen otherwise names.
 */
const Keys = () => (
  <div className={keysStyles}>
    <span className={keyStyles}>
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd> Move
    </span>
    <span className={keyStyles}>
      <Kbd>↵</Kbd> Open
    </span>
    <span className={keyStyles}>
      <Kbd>esc</Kbd> Close
    </span>
  </div>
);

/**
 * Which of `count` rows is highlighted: the one walked to, the first, or none.
 *
 * The middle case is the one worth spelling out. A query that has narrowed the
 * list to something has already chosen — that is what typing a name is for —
 * so Enter takes the top row without anybody pressing an arrow key. An *empty*
 * box has not chosen, even though every file is on screen and one of them is
 * first, so it highlights nothing and Enter does nothing.
 */
const highlightIn = (
  count: number,
  query: string,
  stepped: number | undefined,
): number | undefined => {
  if (count === 0) {
    return undefined;
  } else if (stepped !== undefined) {
    return Math.min(stepped, count - 1);
  } else if (query.trim() === "") {
    return undefined;
  } else {
    return 0;
  }
};

/**
 * Where an arrow key lands, clamped rather than wrapped.
 *
 * Wrapping is what a menu does, and a menu is short. A home directory is not:
 * an Up press that jumped to the bottom of two hundred rows would lose the
 * user's place rather than move it.
 */
const steppedTo = (
  from: number | undefined,
  by: number,
  count: number,
): number | undefined => {
  if (count === 0) {
    return undefined;
  } else if (from === undefined) {
    return by > 0 ? 0 : count - 1;
  } else {
    return Math.min(Math.max(from + by, 0), count - 1);
  }
};

/** What tells one row from the others across a keystroke. */
const keyOf = (choice: Choice): string => {
  switch (choice.kind) {
    case ChoiceKind.File: {
      return `file:${choice.row.path}`;
    }
    // The URL as well as the kind, so a search that changed with the typing
    // is a new row for the preview to settle on.
    case ChoiceKind.Site: {
      return `site:${choice.url}`;
    }
    case ChoiceKind.Search: {
      return `search:${choice.url}`;
    }
  }
};

/** A row's own id, which is what `aria-activedescendant` points at. */
const rowId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;

/**
 * Scroll the row the highlight just arrived at into the list.
 *
 * A home is longer than the list is tall, so without this the keyboard walks
 * off the bottom of what is drawn and the user is moving something they
 * cannot see. `nearest` because the row is usually one line away: scrolling
 * it to the middle would move the whole list under a press that moved one
 * row. React hands a detached row `null`, which is the walk leaving rather
 * than arriving and so has nothing to scroll.
 */
const keepInView = (row: HTMLElement | null) => {
  if (row !== null) {
    row.scrollIntoView({ block: "nearest" });
  }
};

const panelStyles = vstack({
  alignItems: "stretch",
  gap: 3,
});

// The rows and the preview side by side, the preview the wider: a row is a
// name over its directory and needs little width, and the preview is a page,
// a picture or a file's text.
const splitStyles = css({
  display: "grid",
  gap: 3,
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
});

// Tall enough to be worth scrolling and short enough to leave the backdrop
// showing: the panel is a thing over the desktop, and one that reached the
// bottom of the screen would read as a page. A block size rather than a
// maximum, so the panel is the same height however many rows the query left
// — see the note at the call site.
const resultsStyles = css({
  // A ground a shade off the panel's, so the room the fixed height keeps
  // reads as a box waiting to be filled rather than as panel nobody used.
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  blockSize: 120,
  borderRadius: "md",
  overflowY: "auto",
  padding: 1,
  // A bar the width of a hairline and the color of one, because this list is
  // scrolled with the arrow keys: what it is for here is saying there is more
  // below, not being dragged.
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
  // So a row scrolled to by `keepInView` lands inside the box rather than
  // flush against the edge it came over.
  scrollPaddingBlock: 1,
});

// The same ground and the same height as the rows beside it, so the two read
// as one box split in half.
//
// Its own color, because the pane is a region of its own: text in it is drawn
// in the panel's foreground rather than whatever the document defaults to,
// which over the glass was a dark gray on dark glass.
const previewStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  blockSize: 120,
  borderRadius: "md",
  color: "foreground",
  overflow: "hidden",
});

// A picture or a video the size of the pane at most, and never cropped.
const mediaStyles = css({
  blockSize: "100%",
  display: "block",
  inlineSize: "100%",
  objectFit: "contain",
});

// A pane with no picture of its own: a large outline glyph for the kind of
// thing it is about, in the middle, quiet enough to read as an absence rather
// than as something to look at, over what it is and why that is all.
const placeholderStyles = vstack({
  blockSize: "100%",
  color: "muted",
  gap: 2,
  justifyContent: "center",
  padding: 6,
  textAlign: "center",
});

const placeholderTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const placeholderNoteStyles = css({
  fontSize: "sm",
});

// The page a URL is, drawn small and not touchable: the pointer passes through
// it to the pane, so a click cannot take the keyboard out of the box.
const viewStyles = css({
  blockSize: "100%",
  border: "none",
  display: "block",
  inlineSize: "100%",
  pointerEvents: "none",
});

const textPreviewStyles = css({
  blockSize: "100%",
  fontFamily: "mono",
  fontSize: "sm",
  margin: 0,
  overflow: "hidden",
  padding: 3,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

const entriesStyles = css({
  fontSize: "sm",
  listStyle: "none",
  margin: 0,
  padding: 3,
});

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 6%, transparent)",
  },
  // The pointer's row, which is not the keyboard's: a tile a shade brighter
  // and its glyph at full strength, where the walked-to row below takes the
  // accent. Two signals that have to be told apart, because both can be on
  // screen at once and only one of them is what Enter would take.
  "&:hover:not([data-highlighted]) [data-row-tile]": {
    borderColor: "color-mix(in oklab, {colors.foreground} 16%, transparent)",
    color: "foreground",
  },
  // A SOLID GLYPH FOR THE ROW BEING ATTENDED TO, by the pointer or by the
  // keyboard. An outline glyph is mostly the ground it is drawn on, so a row
  // that lightens its ground takes the glyph's contrast with it and the thing
  // meant to be read best is read worst.
  "&:is(:hover, [data-highlighted]) [data-row-glyph=reached]": { opacity: 1 },
  "&:is(:hover, [data-highlighted]) [data-row-glyph=resting]": { opacity: 0 },
  // The walked-to row, in the desktop's own accent: a wash that fades across
  // the row rather than a band of flat color, stronger than the hover above it
  // on purpose — hover is where the pointer happens to be, and this is what
  // Enter would take.
  "&[data-highlighted]": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in oklab, {colors.accent} 30%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
  },
  "&[data-highlighted] [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 28%, transparent)",
    borderColor: "color-mix(in oklab, {colors.accent} 45%, transparent)",
    color: "accent",
  },
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  fontSize: "sm",
  gap: 2.5,
  paddingBlock: 1.5,
  paddingInline: 2,
  transition: "background-color {durations.fast} {easings.out}",
});

// The glyph sits in a tile of its own rather than loose beside the name: it
// gives every row the same shoulder to start at whatever the name's length,
// and it is the thing the highlight can light up without touching the text.
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

// Both weights in the one cell the tile has, so the swap moves nothing and
// the tile's size is the glyph's whichever of them is showing.
const rowGlyphStyles = css({
  // The outline one is what a row is drawn with, so it is the one that needs
  // no rule; the row above is what shows the other.
  "&[data-row-glyph=reached]": { opacity: 0 },
  display: "inline-flex",
  gridArea: "1 / 1",
  transition: "opacity {durations.fast} {easings.out}",
});

// The letters the query is responsible for. `mark`'s own yellow is a
// highlighter pen on a page; what this is marking is why a row is on screen,
// so it is said in the color the desktop says "this one" in.
const markStyles = css({
  backgroundColor: "transparent",
  color: "accent",
  fontWeight: "semibold",
});

// The directory over the name, each a line of its own that gives way at its
// own end: stacked, neither can take the other's width, and the row needs only
// as much of the panel as its longer line.
const rowTextStyles = css({
  display: "flex",
  flex: "1 1 auto",
  flexDirection: "column",
  minInlineSize: 0,
});

// What was typed part of, so the larger of the two lines.
const rowNameStyles = css({
  fontSize: "md",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// What a site or a search row does, said quieter than what it does it to.
const rowVerbStyles = css({
  color: "muted",
});

// A small line over the name. A directory is what tells two files of one name
// apart, so it is read when the names alone have not settled it, and it is
// said quieter than the name for that reason.
const rowDirectoryStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// Figures that keep their width as they change, so the counter does not
// shuffle sideways under the typing.
const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});

// Beside the keys and at the other end of the footer, in the color the panel
// says everything provisional in. Pushed left of them by `marginInlineEnd`,
// because the footer lays its children out to the right and this is the half
// that is news.
const indexingStyles = hstack({
  color: "muted",
  fontSize: "xs",
  gap: 1.5,
  margin: 0,
  marginInlineEnd: "auto",
});

// A full turn, for the one thing on this panel that is still happening. On the
// span rather than on the glyph, because a Phosphor icon is somebody else's
// component and this panel styles its icons by what they sit in — the same
// wrapper the row tiles use.
//
// `prefers-reduced-motion` stops it: what the line says is in the words, and
// the turn is only what keeps them from reading as a state nobody is working
// on.
const spinnerStyles = css({
  _motionReduce: { animationName: "none" },
  alignItems: "center",
  animation: "spin {durations.spin} {easings.linear} infinite",
  color: "accent",
  display: "inline-flex",
  flexShrink: 0,
});

const keysStyles = hstack({
  color: "muted",
  fontSize: "xs",
  gap: 4,
});

const keyStyles = hstack({
  gap: 1,
});
