import type { ClipboardMessage } from "@domicile/chrome-sdk/host-message";
import { ModalDialog } from "@domicile/component-library/ModalDialog";
import { useEffect, useId, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, vstack } from "../../styled-system/patterns";

/** What the list is called, for the keyboard that walks it. */
const HISTORY = "What has been copied";

type Props = {
  /** What has been copied, newest first, as the compositor described it. */
  entries: ClipboardMessage["entries"];
  /** Put this row back on the clipboard, by the id the compositor gave it. */
  onCopy: (entry: number) => void;
  /** Escape, a click on the backdrop, or a row chosen. The desktop decides. */
  onDismiss: () => void;
  open: boolean;
};

/**
 * What has been copied on this desktop, to put one of it back.
 *
 * **A Wayland clipboard holds one thing and holds it only while the client
 * that copied it is running**, so closing the terminal you copied out of
 * empties it. The compositor keeps the history — it is the process a
 * `set_selection` arrives at — and this is the list of it: choosing a row asks
 * the compositor to make that row the selection, after which the next paste in
 * any window is that row, served by the compositor rather than by whichever
 * client first copied it.
 *
 * **It does not close itself.** Whether the panel is open is desktop state,
 * kept in the same reduction as everything else the keys do — see
 * `launcher/Launcher.tsx`, which says why at length. Choosing a row reports
 * both the choice and the dismissal, because a panel still up over the window
 * you are about to paste into has not finished the job.
 */
export const Clipboard = ({ entries, onCopy, onDismiss, open }: Props) => (
  <ModalDialog
    onOpenChange={(next) => {
      if (!next) {
        onDismiss();
      }
    }}
    open={open}
    title="Clipboard"
  >
    {/*
      Inside the dialog, so it is unmounted with it: base-ui portals the popup
      only while it is open, which is what makes every open start on a list
      nobody has walked, with no effect anywhere to reset it.
    */}
    <History entries={entries} onCopy={onCopy} onDismiss={onDismiss} />
  </ModalDialog>
);

type HistoryProps = {
  entries: ClipboardMessage["entries"];
  onCopy: (entry: number) => void;
  onDismiss: () => void;
};

/**
 * The rows, and the keyboard that walks them.
 *
 * A listbox that holds the focus itself rather than a combobox over one: there
 * is nothing to type here — the rows are what was copied, and a person opening
 * this is looking for one of them by eye. `aria-activedescendant` is still how
 * the walk is reported, because the focus stays on the list while the
 * highlight moves.
 */
const History = ({ entries, onCopy, onDismiss }: HistoryProps) => {
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Where the arrow keys have walked to, and `undefined` for a list nobody has
  // walked — which is every panel the moment it opens. Nothing is highlighted
  // then, because nothing has been chosen: the first row is the newest copy
  // rather than the likeliest answer, and the newest copy is the one already
  // on the clipboard.
  const [stepped, setStepped] = useState<number | undefined>(undefined);

  // The panel is up because somebody asked for it, so the keyboard belongs on
  // the list. Taken deliberately rather than left to the dialog: base-ui puts
  // the focus on the first thing in the popup that can hold it, which is the
  // close button in the corner — a panel where the first arrow key does
  // nothing costs more than scrolling back through the window you copied from.
  useEffect(() => {
    list.current?.focus();
  }, []);

  const pick = (entry: number) => {
    onCopy(entry);
    onDismiss();
  };

  return entries.length === 0 ? (
    <p className={emptyStyles}>Nothing has been copied yet</p>
  ) : (
    <div
      aria-activedescendant={
        stepped === undefined ? undefined : rowId(listId, stepped)
      }
      aria-label={HISTORY}
      className={listStyles}
      id={listId}
      onKeyDown={(event) => {
        switch (event.key) {
          case "ArrowDown": {
            // Taken from the list, which would otherwise scroll past the row
            // the highlight just moved to.
            event.preventDefault();
            setStepped(steppedTo(stepped, 1, entries.length));
            break;
          }
          case "ArrowUp": {
            event.preventDefault();
            setStepped(steppedTo(stepped, -1, entries.length));
            break;
          }
          case "Enter": {
            const chosen = stepped === undefined ? undefined : entries[stepped];
            // `undefined` is Enter on a list nobody has walked, which has
            // chosen nothing. Nothing to copy, and nothing to report either.
            if (chosen !== undefined) {
              pick(chosen.id);
            }
            break;
          }
        }
      }}
      ref={list}
      role="listbox"
      tabIndex={0}
    >
      {entries.map((entry, at) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox above owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
        <div
          aria-selected={at === stepped}
          className={rowStyles}
          data-highlighted={at === stepped ? "" : undefined}
          id={rowId(listId, at)}
          key={entry.id}
          onClick={() => {
            pick(entry.id);
          }}
          role="option"
          // Reachable programmatically and never in the tab ring: the focus
          // stays on the list, which is what makes walking and choosing one
          // gesture rather than two.
          tabIndex={-1}
        >
          {entry.preview}
        </div>
      ))}
    </div>
  );
};

/**
 * Where an arrow key lands, clamped rather than wrapped.
 *
 * Clamped for the launcher's reason: wrapping is what a menu does, and an Up
 * press that jumped to the oldest of thirty-two copies would lose the user's
 * place rather than move it.
 */
const steppedTo = (
  from: number | undefined,
  by: number,
  count: number,
): number | undefined => {
  if (from === undefined) {
    return by > 0 ? 0 : count - 1;
  } else {
    return Math.min(Math.max(from + by, 0), count - 1);
  }
};

/** A row's own id, which is what `aria-activedescendant` points at. */
const rowId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;

// A desktop that has just started, which is the ordinary way to see this: the
// history is the compositor's memory and nothing in it outlives a restart.
const emptyStyles = css({
  color: "muted",
  fontSize: "sm",
  paddingBlock: 2,
});

// Tall enough to be worth scrolling and short enough to leave the backdrop
// showing, like the launcher's: the panel is a thing over the desktop rather
// than a page.
const listStyles = vstack({
  alignItems: "stretch",
  gap: 1,
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
  // A copy is read from its start — what identifies it is the first few words
  // — and a long one is already cut to a row by the compositor. This is what
  // keeps a newline in the middle of one from turning a row into a paragraph.
  overflow: "hidden",
  paddingBlock: 1,
  paddingInline: 2,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
