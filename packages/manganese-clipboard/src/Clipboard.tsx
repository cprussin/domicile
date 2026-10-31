import { EmptyState } from "@domicile-desktop/component-library/EmptyState";
import { Input } from "@domicile-desktop/component-library/Input";
import {
  stepOf,
  steppedTo,
} from "@domicile-desktop/component-library/list-walk";
import { Marked } from "@domicile-desktop/component-library/Marked";
import { ModalDialog } from "@domicile-desktop/component-library/ModalDialog";
import {
  ResultList,
  resultId,
} from "@domicile-desktop/component-library/ResultList";
import { RowTile } from "@domicile-desktop/component-library/RowTile";
import type { DomicileClipboardEntry } from "@domicile-desktop/sdk/domicile-host";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { ImageIcon } from "@phosphor-icons/react/dist/ssr/Image";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { TextTIcon } from "@phosphor-icons/react/dist/ssr/TextT";
import { memo, useId, useState } from "react";

import { css } from "../styled-system/css";
import { flex, vstack } from "../styled-system/patterns";
import { CopyKind, kindOf } from "./copy-kind";

/** The box's placeholder and accessible name. */
const PROMPT = "Search what you copied";

/** Glyph size in the box. */
const ICON_SIZE = 16;

type Props = {
  /** The clipboard history, newest first, from the compositor. */
  entries: readonly DomicileClipboardEntry[];
  /** Restores this entry, by its compositor ID, to the clipboard. */
  onCopy: (entry: number) => void;
  /** Escape, a backdrop click, or a chosen row. The desktop decides. */
  onDismiss: () => void;
  open: boolean;
  /** The screen to open on: the one with the keyboard. */
  screen: string;
};

/**
 * The clipboard history panel, for restoring an earlier copy. Looks and
 * steers like the launcher: a search box over its rows.
 *
 * A Wayland selection lasts only while the copying client runs, so the
 * compositor keeps the history. Choosing a row asks the compositor to serve
 * that entry as the selection.
 *
 * Open state is desktop state, as with the launcher. Choosing a row reports
 * both the choice and the dismissal, so the panel is gone before the paste.
 */
export const Clipboard = memo(
  ({ entries, onCopy, onDismiss, open, screen }: Props) => (
    <ModalDialog
      // Keyboard-driven, as the launcher; Escape closes it.
      closeButton={false}
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
      open={open}
      screen={screen}
      // Translucent, as the launcher.
      surface="glass"
      // The search box heads the panel, so the title is for screen readers.
      title="Clipboard history"
      titleHidden
    >
      {/*
      Inside the dialog so it unmounts on close, and every open starts with
      an empty box on the previous copy.
    */}
      {entries.length === 0 ? (
        <EmptyState
          hint="Things you copy show up here."
          icon={ClipboardTextIcon}
          title="Nothing copied yet"
        />
      ) : (
        <History entries={entries} onCopy={onCopy} onDismiss={onDismiss} />
      )}
    </ModalDialog>
  ),
);

type HistoryProps = {
  entries: readonly DomicileClipboardEntry[];
  onCopy: (entry: number) => void;
  onDismiss: () => void;
};

/**
 * The search box and the rows it narrows.
 *
 * A combobox over a listbox, as in the launcher: focus stays in the box and
 * `aria-activedescendant` marks the highlighted row.
 */
const History = ({ entries, onCopy, onDismiss }: HistoryProps) => {
  const listId = useId();
  const [query, setQuery] = useState("");
  // The newest copy is already on the clipboard, so the highlight starts on
  // the one before it.
  const [stepped, setStepped] = useState(entries.length > 1 ? 1 : 0);
  const shown = matching(entries, query);
  const highlighted =
    shown.length === 0 ? undefined : Math.min(stepped, shown.length - 1);
  const current = entries[0]?.id;

  const pick = (entry: DomicileClipboardEntry) => {
    onCopy(entry.id);
    onDismiss();
  };

  return (
    <div className={panelStyles}>
      <div className={searchStyles}>
        <Input
          aria-activedescendant={
            highlighted === undefined
              ? undefined
              : resultId(listId, highlighted)
          }
          aria-controls={listId}
          aria-expanded
          aria-label={PROMPT}
          autoFocus
          flush
          onChange={(event) => {
            setQuery(event.target.value);
            // Reset, since the old index refers to the previous list.
            setStepped(0);
          }}
          onKeyDown={(event) => {
            const step = stepOf(event);
            const chosen =
              highlighted === undefined ? undefined : shown[highlighted];
            if (step !== undefined) {
              // Stop the box from moving the caret.
              event.preventDefault();
              setStepped(steppedTo(highlighted ?? 0, step, shown.length));
            } else if (event.key === "Enter" && chosen !== undefined) {
              event.preventDefault();
              pick(chosen);
            }
          }}
          placeholder={PROMPT}
          prefixIcon={<MagnifyingGlassIcon size={ICON_SIZE} />}
          role="combobox"
          size="lg"
          // Copies are often code or addresses, which would be flagged as
          // misspellings.
          spellCheck={false}
          suffixIcon={
            <span aria-hidden="true" className={countStyles}>
              {countOf(entries.length, shown.length, query)}
            </span>
          }
          value={query}
        />
      </div>
      <div className={rowsStyles}>
        {shown.length === 0 ? (
          <EmptyState
            icon={MagnifyingGlassIcon}
            title="Nothing copied matches"
          />
        ) : (
          <ResultList
            highlighted={highlighted}
            id={listId}
            items={shown}
            keyOf={(entry) => entry.id.toString()}
            onChoose={pick}
            onHighlight={setStepped}
          >
            {(entry) => (
              <>
                <RowTile icon={glyphOf(kindOf(entry))} />
                <span className={textStyles}>
                  <span className={lineStyles}>
                    <Marked query={query} text={lineOf(entry.preview)} />
                  </span>
                  {entry.id === current && (
                    <span className={detailStyles}>On the clipboard now</span>
                  )}
                </span>
              </>
            )}
          </ResultList>
        )}
      </div>
    </div>
  );
};

/** A copy on one line: every run of spaces and line breaks is one space. */
const lineOf = (preview: string): string =>
  preview.trim().replaceAll(/\s+/g, " ");

/** The copies whose line holds every word of `query`, ignoring case. */
const matching = (
  entries: readonly DomicileClipboardEntry[],
  query: string,
): readonly DomicileClipboardEntry[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  return entries.filter((entry) => {
    const line = lineOf(entry.preview).toLowerCase();
    return words.every((word) => line.includes(word));
  });
};

/** The count at the box's end: every copy, or the matches once narrowed. */
const countOf = (copies: number, shown: number, query: string): string => {
  if (query.trim() === "") {
    return copies === 1 ? "1 copy" : `${copies.toString()} copies`;
  } else {
    return `${shown.toString()} matched`;
  }
};

const glyphOf = (kind: CopyKind) => {
  switch (kind) {
    case CopyKind.Image: {
      return ImageIcon;
    }
    case CopyKind.Link: {
      return LinkSimpleIcon;
    }
    case CopyKind.Text: {
      return TextTIcon;
    }
  }
};

const panelStyles = vstack({
  alignItems: "stretch",
  gap: 3,
});

// The search box is the panel's header, set off by a line under it, as in
// the launcher.
const searchStyles = css({
  borderBlockEnd:
    "1px solid color-mix(in oklab, {colors.foreground} 10%, transparent)",
  // Up into the popup's top padding, which is sized for a title.
  marginBlockStart: -3,
  marginInline: -5,
  paddingBlockEnd: 2,
  paddingInline: 3,
});

// Tabular figures, so the count doesn't shift as it changes.
const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});

// The launcher's results well. Tall enough to scroll, short enough to leave
// the backdrop visible.
const rowsStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  borderRadius: "md",
  maxBlockSize: "60cqh",
  overflowY: "auto",
  padding: 1,
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
  // Keeps a row scrolled by `keepInView` off the edge.
  scrollPaddingBlock: 1,
});

const textStyles = flex({
  direction: "column",
  flex: "1 1 auto",
  minInlineSize: 0,
});

// The compositor already cuts long copies short; this cuts them to the row.
const lineStyles = css({
  fontSize: "md",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const detailStyles = css({
  color: "muted",
  fontSize: "xs",
});
