import { Input } from "@domicile/component-library/Input";
import { ModalDialog } from "@domicile/component-library/ModalDialog";
import { useId, useMemo, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, vstack } from "../../styled-system/patterns";
import type { Launch } from "./launch";
import { launchFor } from "./launch";
import { matching } from "./matching";

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
    onOpenChange={(next) => {
      if (!next) {
        onDismiss();
      }
    }}
    open={open}
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
  const highlighted = highlightIn(shown, query, stepped);

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
        placeholder="Open a file, a URL, or search"
        role="combobox"
        value={query}
      />
      {/*
        A listbox of options rather than a list of buttons: the rows are one
        choice among many and the keyboard that walks them never leaves the box
        above, which is what `aria-activedescendant` says. Two hundred buttons
        would say there are two hundred things to press.

        Divs rather than `ul`/`li` because an `li` is non-interactive markup
        and an option is not — the roles are the structure here, and doubling
        them up with list elements is what the lint is objecting to.
      */}
      <div className={listStyles} id={listId} role="listbox">
        {shown.map((path, at) => (
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
            role="option"
            // Reachable programmatically and never in the tab ring: focus
            // stays in the box, which is what makes typing and choosing one
            // gesture rather than two.
            tabIndex={-1}
          >
            {path}
          </div>
        ))}
      </div>
    </div>
  );
};

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

const panelStyles = vstack({
  alignItems: "stretch",
  gap: 3,
});

// Tall enough to be worth scrolling and short enough to leave the backdrop
// showing: the panel is a thing over the desktop, and one that reached the
// bottom of the screen would read as a page.
const listStyles = css({
  maxBlockSize: 80,
  overflowY: "auto",
});

const rowStyles = flex({
  _hover: { backgroundColor: "card" },
  "&[data-highlighted]": {
    backgroundColor:
      "color-mix(in oklab, {colors.accent} 25%, {colors.background})",
  },
  align: "center",
  borderRadius: "sm",
  color: "foreground",
  cursor: "pointer",
  fontFamily: "mono",
  fontSize: "sm",
  // A path is read from its end — the name is what identifies it and the
  // directories are what disambiguate — so a long one loses its middle rather
  // than the part being looked for.
  overflow: "hidden",
  paddingBlock: 1,
  paddingInline: 2,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
