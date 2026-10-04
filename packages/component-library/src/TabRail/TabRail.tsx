import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { memo, useCallback, useState } from "react";
import { css, cx } from "../../styled-system/css";
import { hstack, stack } from "../../styled-system/patterns";

import { Button } from "../Button/Button";

/** `MouseEvent.button` for the middle button, which closes a tab. */
const MIDDLE_BUTTON = 1;

/** Which side of a drop target a dragged tab lands on. */
export type DropPosition = "before" | "after";

/** One tab: a stable `id`, a `label`, and whether it can close (default yes). */
export type TabRailTab = {
  id: string;
  label: string;
  closable?: boolean | undefined;
};

type Props = {
  tabs: readonly TabRailTab[];
  /** The `id` of the active tab. */
  activeId: string;
  /** Make the tab `id` active. */
  onSelect: (id: string) => void;
  /** Close the tab `id`. */
  onClose: (id: string) => void;
  /** Move the tab `fromId` to just before/after the tab `toId`. */
  onReorder: (fromId: string, toId: string, position: DropPosition) => void;
  /** Open a new tab, from the built-in new-tab button. */
  onNew: () => void;
  /** Header content beside the new-tab button, e.g. a wordmark. */
  brand?: ReactNode | undefined;
  /** Footer content, e.g. settings or theme controls. */
  footer?: ReactNode | undefined;
};

/**
 * A vertical tab sidebar; see {@link Tabs} for a horizontal bar. Controlled:
 * it holds no app state and reports actions through callbacks.
 *
 * - A closable row closes from its close button or a middle-click.
 * - On a focused row, Alt+Up/Down switches tabs and Alt+Shift+Up/Down moves
 *   the row. Rows also reorder by drag.
 * - The select control is not a {@link Button}, which lacks `aria-current`
 *   styling and truncation.
 */
export const TabRail = ({
  activeId,
  brand,
  footer,
  onClose,
  onNew,
  onReorder,
  onSelect,
  tabs,
}: Props) => {
  // The dragged tab, for drag styling only; `onReorder` does the move.
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);

  const handleDragStart = useCallback((tabId: string) => {
    setDraggingId(tabId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(undefined);
  }, []);

  const handleReorderOver = useCallback(
    (toId: string, position: DropPosition) => {
      if (draggingId !== undefined && draggingId !== toId) {
        onReorder(draggingId, toId, position);
      }
    },
    [draggingId, onReorder],
  );

  // Alt+Up/Down switches to the neighbor and moves focus; with Shift it moves
  // the row past the neighbor.
  const handleKeyMove = useCallback(
    (event: KeyboardEvent<HTMLLIElement>, index: number) => {
      if (!event.altKey) {
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const current = tabs[index];
      const neighbor = tabs[index + delta];
      if (current === undefined || neighbor === undefined) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        onReorder(current.id, neighbor.id, delta < 0 ? "before" : "after");
      } else {
        onSelect(neighbor.id);
        focusSiblingTab(event.currentTarget, delta);
      }
    },
    [tabs, onReorder, onSelect],
  );

  return (
    <nav aria-label="Tabs" className={railStyles}>
      <div className={headerStyles}>
        {brand}
        <Button label="New tab" onClick={onNew} size="sm" variant="ghost">
          <PlusIcon size={18} />
        </Button>
      </div>
      <ul className={listStyles}>
        {tabs.map((tab, index) => (
          <TabRow
            active={tab.id === activeId}
            closable={tab.closable !== false}
            dragging={tab.id === draggingId}
            hoverable={draggingId === undefined}
            index={index}
            key={tab.id}
            onClose={onClose}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            onKeyDown={handleKeyMove}
            onReorderOver={handleReorderOver}
            onSelect={onSelect}
            tab={tab}
          />
        ))}
      </ul>
      {footer !== undefined && <div className={footerStyles}>{footer}</div>}
    </nav>
  );
};

type TabRowProps = {
  active: boolean;
  closable: boolean;
  dragging: boolean;
  hoverable: boolean;
  index: number;
  onClose: (tabId: string) => void;
  onDragEnd: () => void;
  onDragStart: (tabId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>, index: number) => void;
  onReorderOver: (toId: string, position: DropPosition) => void;
  onSelect: (tabId: string) => void;
  tab: TabRailTab;
};

/**
 * One tab row. Handles drag, keyboard and middle-click events and calls the
 * handlers with tab ids.
 */
const TabRow = memo(
  ({
    active,
    closable,
    dragging,
    hoverable,
    index,
    onClose,
    onDragEnd,
    onDragStart,
    onKeyDown,
    onReorderOver,
    onSelect,
    tab,
  }: TabRowProps) => (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the row is a drag/keyboard reorder affordance; its actions (select, close) are keyboard-reachable through the buttons it contains
    <li
      className={cx(
        rowStyles,
        rowActiveStyles,
        hoverable && rowHoverStyles,
        dragging && rowDraggingStyles,
      )}
      draggable
      onAuxClick={(event) => {
        if (closable && event.button === MIDDLE_BUTTON) {
          onClose(tab.id);
        }
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onReorderOver(tab.id, dropPosition(event));
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tab.id);
        onDragStart(tab.id);
      }}
      onKeyDown={(event) => {
        onKeyDown(event, index);
      }}
      // A middle press would start Chromium's autoscroll in the scrolling
      // rail. Only the middle button is suppressed.
      onMouseDown={(event) => {
        if (event.button === MIDDLE_BUTTON) {
          event.preventDefault();
        }
      }}
    >
      <button
        aria-current={active ? "page" : undefined}
        className={selectStyles}
        onClick={() => {
          onSelect(tab.id);
        }}
        type="button"
      >
        {tab.label}
      </button>
      {closable && (
        <Button
          label={`Close ${tab.label}`}
          onClick={() => {
            onClose(tab.id);
          }}
          size="xs"
          variant="ghost"
        >
          <XIcon size={14} />
        </Button>
      )}
    </li>
  ),
);

/** Which half of the row the cursor is over, i.e. where a drop lands. */
const dropPosition = (event: DragEvent<HTMLLIElement>): DropPosition => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
};

/** Focuses the neighboring tab after a keyboard switch, so a held Alt+Arrow
 *  keeps moving. */
const focusSiblingTab = (row: HTMLLIElement, delta: -1 | 1) => {
  const sibling =
    delta < 0 ? row.previousElementSibling : row.nextElementSibling;
  sibling?.querySelector("button")?.focus();
};

const railStyles = stack({
  backgroundColor: "background",
  blockSize: "100%",
  borderInlineEndColor: "border",
  borderInlineEndStyle: "solid",
  borderInlineEndWidth: "1px",
  flexShrink: 0,
  gap: 0,
  inlineSize: 65,
  minBlockSize: 0,
});

const headerStyles = hstack({
  gap: 2,
  justify: "space-between",
  paddingBlock: 2,
  paddingInline: 3,
});

const listStyles = stack({
  flex: 1,
  gap: 0.5,
  listStyleType: "none",
  margin: 0,
  overflowY: "auto",
  paddingBlock: 1,
  paddingInline: 1.5,
});

const rowStyles = hstack({
  backgroundColor: "transparent",
  borderRadius: "sm",
  color: "muted",
  gap: 1,
  minInlineSize: 0,
  paddingInlineEnd: 1.5,
  paddingInlineStart: 3,
  transition:
    "background-color {durations.fast} {easings.default}, color {durations.fast} {easings.default}",
});

// Hover styling, off during a drag so it doesn't obscure reordering rows.
const rowHoverStyles = css({
  _hover: { backgroundColor: "card", color: "foreground" },
});

// The active tab, keyed off `aria-current`. The attribute selector outranks
// the base `muted` color, so hover doesn't dim it.
const rowActiveStyles = css({
  "&:has([aria-current=page])": {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 8%, {colors.background})",
    color: "foreground",
  },
});

const rowDraggingStyles = css({ opacity: "dragging" });

const selectStyles = css({
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  flex: 1,
  fontFamily: "inherit",
  fontSize: "xs",
  lineHeight: "tight",
  minInlineSize: 0,
  outlineStyle: "none",
  overflow: "hidden",
  paddingBlock: 1.75,
  textAlign: "start",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const footerStyles = stack({
  borderBlockStartColor: "border",
  borderBlockStartStyle: "solid",
  borderBlockStartWidth: "1px",
  gap: 0.5,
  paddingBlock: 2,
  paddingInline: 2.5,
});
