import type { ReactNode } from "react";

import { flex, hstack } from "../../styled-system/patterns";
import { keepInView } from "../list-walk";

type Props<Item> = {
  /** Draws an item's row, such as a `RowTile` and its name. */
  children: (item: Item) => ReactNode;
  /** The row lit by the keyboard or the pointer, if any. */
  highlighted: number | undefined;
  /** The listbox's ID, which the combobox that drives it names. */
  id: string;
  items: readonly Item[];
  keyOf: (item: Item) => string;
  /** Names the list, when no combobox names it. */
  label?: string | undefined;
  onChoose: (item: Item) => void;
  /** The pointer moved over the row at `at`. */
  onHighlight: (at: number) => void;
};

/**
 * The rows under a search box, as in the launcher: one highlight, which the
 * keyboard and the pointer both move, and a click to choose.
 *
 * A listbox driven by `aria-activedescendant`, so focus stays in the box.
 * The box moves the highlight on keys; see `list-walk`. Name the highlighted
 * row with {@link resultId}.
 */
export const ResultList = <Item,>({
  children,
  highlighted,
  id,
  items,
  keyOf,
  label,
  onChoose,
  onHighlight,
}: Props<Item>) => (
  // Divs rather than `ul`/`li`, because lint rejects interactive roles on
  // list elements.
  <div aria-label={label} className={listStyles} id={id} role="listbox">
    {items.map((item, at) => (
      // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox that names this list owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
      <div
        aria-selected={at === highlighted}
        className={rowStyles}
        data-highlighted={at === highlighted ? "" : undefined}
        id={resultId(id, at)}
        key={keyOf(item)}
        onClick={() => {
          onChoose(item);
        }}
        // Keeps focus in the box.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        // Pointer move rather than enter, so rows scrolling under a still
        // pointer don't take the highlight.
        onPointerMove={() => {
          onHighlight(at);
        }}
        // A stable function on the highlighted row only, so React calls it
        // only when the highlight moves.
        ref={at === highlighted ? keepInView : undefined}
        role="option"
        // Out of the tab order; focus stays in the box.
        tabIndex={-1}
      >
        {children(item)}
      </div>
    ))}
  </div>
);

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = hstack({
  // A neutral wash, so color is left for what needs attention. There is no
  // separate hover style; the pointer moves the highlight.
  "&[data-highlighted]": {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 10%, transparent)",
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

/** The row at `at`'s element ID, for `aria-activedescendant`. */
export const resultId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;
