import { Input } from "@domicile/component-library/Input";
import { Kbd } from "@domicile/component-library/Kbd";
import { ModalDialog } from "@domicile/component-library/ModalDialog";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack, vstack } from "../../styled-system/patterns";
import { directoriesIn, fileRow } from "./file-row";
import type { Hint } from "./hint";
import { HintKind, hintFor } from "./hint";
import type { Launch } from "./launch";
import { launchFor } from "./launch";
import { matching } from "./matching";

/** What the box asks for, as its placeholder and as its accessible name. */
const PROMPT = "Open a file, a URL, or search";

/** How big the glyph beside a row, and in the box, is drawn. */
const ICON_SIZE = 16;

type Props = {
  /** What there is to open, in the order the host answered. */
  files: readonly string[];
  /** Escape, or a click on the backdrop. The desktop decides what that means. */
  onDismiss: () => void;
  onLaunch: (launch: Launch) => void;
  open: boolean;
};

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
export const Launcher = ({ files, onDismiss, onLaunch, open }: Props) => (
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
    title="Open"
  >
    {/*
      Inside the dialog, so it is unmounted with it: base-ui portals the popup
      only while it is open, which is what makes every open start on an empty
      box and a full list without an effect anywhere to clear them.
    */}
    <Query files={files} onLaunch={onLaunch} />
  </ModalDialog>
);

type QueryProps = {
  files: readonly string[];
  onLaunch: (launch: Launch) => void;
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
const Query = ({ files, onLaunch }: QueryProps) => {
  const listId = useId();
  const [query, setQuery] = useState("");
  // Where the arrow keys have walked to, and `undefined` for a list nobody has
  // walked. Not the highlight itself — see `highlightIn`, which is what turns
  // "nobody has walked it" into "the first match, because they typed".
  const [stepped, setStepped] = useState<number | undefined>(undefined);

  const shown = useMemo(() => matching(files, query), [files, query]);
  // Over everything offered rather than over what is shown: `Notes` is a
  // directory whether or not the query still asks about anything inside it.
  const directories = useMemo(() => directoriesIn(files), [files]);
  const highlighted = highlightIn(shown, query, stepped);
  const hint = hintFor(query, files);

  const launch = (typed: string) => {
    const launched = launchFor(typed, files);
    // `undefined` is an empty box, which is Enter on a keystroke nobody meant
    // as a command. Nothing to do, and nothing to report either.
    if (launched !== undefined) {
      onLaunch(launched);
    }
  };

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
              setStepped(steppedTo(highlighted, 1, shown.length));
              break;
            }
            case "ArrowUp": {
              event.preventDefault();
              setStepped(steppedTo(highlighted, -1, shown.length));
              break;
            }
            case "Enter": {
              const chosen =
                highlighted === undefined ? query : shown[highlighted];
              launch(chosen ?? query);
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
        value={query}
      />
      {/*
        THE SAME SIZE WHATEVER IS IN IT. The rows are filtered on every
        keystroke and the host's answer lands after the panel is already up,
        so a box that fitted its contents would resize under the hand typing
        into it — a panel that grew and shrank between one letter and the
        next, taking everything below the rows with it. Scrolling belongs
        here rather than on the listbox, so that the line under the rows
        shares the room rather than being pushed out of it.
      */}
      <div className={resultsStyles}>
        {/*
          A listbox of options rather than a list of buttons: the rows are one
          choice among many and the keyboard that walks them never leaves the
          box above, which is what `aria-activedescendant` says. Two hundred
          buttons would say there are two hundred things to press.

          Divs rather than `ul`/`li` because an `li` is non-interactive markup
          and an option is not — the roles are the structure here, and
          doubling them up with list elements is what the lint is objecting
          to.
        */}
        <div className={listStyles} id={listId} role="listbox">
          {shown.map((path, at) => {
            const row = fileRow(path, directories);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox above owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
              <div
                aria-selected={at === highlighted}
                className={rowStyles}
                data-highlighted={at === highlighted ? "" : undefined}
                id={rowId(listId, at)}
                key={path}
                onClick={() => {
                  launch(path);
                }}
                // Only the highlighted row carries it, and it is the same
                // function every render, so React calls it exactly when the
                // highlight arrives at a row rather than on every keystroke.
                ref={at === highlighted ? keepInView : undefined}
                role="option"
                // Reachable programmatically and never in the tab ring: focus
                // stays in the box, which is what makes typing and choosing one
                // gesture rather than two.
                tabIndex={-1}
              >
                <span className={rowIconStyles} data-row-icon="">
                  {row.isDirectory ? (
                    <FolderIcon size={ICON_SIZE} />
                  ) : (
                    <FileIcon size={ICON_SIZE} />
                  )}
                </span>
                <span className={rowNameStyles}>{row.name}</span>
                {row.directory !== undefined && (
                  <span className={rowDirectoryStyles}>{row.directory}</span>
                )}
              </div>
            );
          })}
        </div>
        {/*
          With a row highlighted the answer is on screen already, and a second
          one under the list would contradict it the moment an arrow key
          moved.
        */}
        {highlighted === undefined && hint !== undefined && (
          <HintLine hint={hint} />
        )}
      </div>
    </div>
  );
};

/** What Enter would do, for a box no row has been chosen in. */
const HintLine = ({ hint }: { hint: Hint }) => {
  const { icon, says, subject } = drawnAs(hint);
  return (
    <p className={hintStyles}>
      <span className={hintIconStyles}>{icon}</span>
      {says} <span className={hintSubjectStyles}>{subject}</span>
    </p>
  );
};

/** The glyph, the verb and the subject one kind of hint is drawn as. */
const drawnAs = (
  hint: Hint,
): { icon: ReactNode; says: string; subject: string } => {
  switch (hint.kind) {
    case HintKind.Edit: {
      return {
        icon: <FileIcon size={ICON_SIZE} />,
        says: "Edit",
        subject: hint.path,
      };
    }
    case HintKind.Search: {
      return {
        icon: <MagnifyingGlassIcon size={ICON_SIZE} />,
        says: "Search for",
        subject: hint.query,
      };
    }
    case HintKind.Site: {
      return {
        icon: <GlobeSimpleIcon size={ICON_SIZE} />,
        says: "Go to",
        subject: hint.url,
      };
    }
  }
};

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
 * Which row is highlighted: the one walked to, the first match, or none.
 *
 * The middle case is the one worth spelling out. A query that has narrowed the
 * list to something has already chosen — that is what typing a name is for —
 * so Enter takes the top row without anybody pressing an arrow key. An *empty*
 * box has not chosen, even though every file is on screen and one of them is
 * first, so it highlights nothing and Enter has only the query to go on.
 */
const highlightIn = (
  shown: readonly string[],
  query: string,
  stepped: number | undefined,
): number | undefined => {
  if (shown.length === 0) {
    return undefined;
  } else if (stepped !== undefined) {
    return Math.min(stepped, shown.length - 1);
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

// Tall enough to be worth scrolling and short enough to leave the backdrop
// showing: the panel is a thing over the desktop, and one that reached the
// bottom of the screen would read as a page. A block size rather than a
// maximum, so the panel is the same height however many rows the query left
// — see the note at the call site.
const resultsStyles = css({
  // A ground a shade off the panel's, so the room the fixed height keeps
  // reads as a box waiting to be filled rather than as panel nobody used.
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  blockSize: 80,
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

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, transparent)",
  },
  // The walked-to row, in the desktop's own accent. Stronger than the hover
  // above it on purpose: hover is where the pointer happens to be and this is
  // what Enter would take.
  "&[data-highlighted]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 22%, transparent)",
  },
  "&[data-highlighted] [data-row-icon]": {
    color: "accent",
  },
  alignItems: "center",
  borderRadius: "sm",
  color: "foreground",
  columnGap: 2,
  cursor: "pointer",
  display: "grid",
  fontSize: "sm",
  // The glyph takes what it needs, the name takes what it needs after that,
  // and the directory takes the rest — so a path too long for the panel loses
  // the part that only disambiguates rather than the part being looked for.
  gridTemplateColumns: "auto minmax(0, auto) minmax(0, 1fr)",
  paddingBlock: 1.5,
  paddingInline: 2,
  transition: "background-color {durations.fast} {easings.out}",
});

const rowIconStyles = css({
  alignItems: "center",
  color: "muted",
  display: "inline-flex",
  transition: "color {durations.fast} {easings.out}",
});

const rowNameStyles = css({
  fontFamily: "mono",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const rowDirectoryStyles = css({
  color: "muted",
  fontFamily: "mono",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// Set like a row rather than like a message, because it stands where the rows
// would be and says the same kind of thing: here is what this line opens.
const hintStyles = hstack({
  color: "muted",
  fontSize: "sm",
  gap: 2,
  margin: 0,
  paddingBlock: 1.5,
  paddingInline: 2,
});

const hintIconStyles = css({
  alignItems: "center",
  color: "accent",
  display: "inline-flex",
});

const hintSubjectStyles = css({
  color: "foreground",
  fontFamily: "mono",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const keysStyles = hstack({
  color: "muted",
  fontSize: "xs",
  gap: 4,
});

const keyStyles = hstack({
  gap: 1,
});
