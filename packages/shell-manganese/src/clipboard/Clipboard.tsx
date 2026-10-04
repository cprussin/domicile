import { ModalDialog } from "@domicile-desktop/component-library/ModalDialog";
import type { ClipboardMessage } from "@domicile-desktop/sdk/host-message";
import { useEffect, useId, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, vstack } from "../../styled-system/patterns";

/** The list's accessible name. */
const HISTORY = "What has been copied";

type Props = {
  /** The clipboard history, newest first, from the compositor. */
  entries: ClipboardMessage["entries"];
  /** Restores this entry, by its compositor ID, to the clipboard. */
  onCopy: (entry: number) => void;
  /** Escape, a backdrop click, or a chosen row. The desktop decides. */
  onDismiss: () => void;
  open: boolean;
  /** The screen to open on: the one with the keyboard. */
  screen: string;
};

/**
 * The clipboard history panel, for restoring an earlier copy.
 *
 * A Wayland selection lasts only while the copying client runs, so the
 * compositor keeps the history. Choosing a row asks the compositor to serve
 * that entry as the selection.
 *
 * Open state is desktop state, as with `launcher/Launcher.tsx`. Choosing a row
 * reports both the choice and the dismissal, so the panel is gone before the
 * paste.
 */
export const Clipboard = ({
  entries,
  onCopy,
  onDismiss,
  open,
  screen,
}: Props) => (
  <ModalDialog
    onOpenChange={(next) => {
      if (!next) {
        onDismiss();
      }
    }}
    open={open}
    screen={screen}
    title="Clipboard"
  >
    {/*
      Inside the dialog so it unmounts on close, and every open starts with
      nothing highlighted.
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
 * The rows and their keyboard navigation.
 *
 * A focused listbox rather than a combobox, since there is nothing to type.
 * `aria-activedescendant` reports the highlight while focus stays on the list.
 */
const History = ({ entries, onCopy, onDismiss }: HistoryProps) => {
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  // The highlighted row, or `undefined` until an arrow key is pressed. Nothing
  // starts highlighted: the newest entry is already on the clipboard.
  const [stepped, setStepped] = useState<number | undefined>(undefined);

  // Focus the list explicitly. base-ui would focus the close button, and the
  // first arrow key would do nothing.
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
            // Keeps the list from scrolling past the highlighted row.
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
            // Enter with nothing highlighted chooses nothing.
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
          // Not in the tab order: focus stays on the list, so navigating and
          // choosing are one gesture.
          tabIndex={-1}
        >
          {entry.preview}
        </div>
      ))}
    </div>
  );
};

/**
 * Where an arrow key lands, clamped rather than wrapped, as in the launcher.
 * Wrapping would jump from the newest to the oldest entry.
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

/** A row's element ID, for `aria-activedescendant`. */
const rowId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;

// Usual right after the desktop starts: the history does not survive a
// restart.
const emptyStyles = css({
  color: "muted",
  fontSize: "sm",
  paddingBlock: 2,
});

// Tall enough to scroll, short enough to leave the backdrop visible, like the
// launcher.
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
  // The compositor already truncates long entries; this keeps an embedded
  // newline from turning a row into a paragraph.
  overflow: "hidden",
  paddingBlock: 1,
  paddingInline: 2,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
