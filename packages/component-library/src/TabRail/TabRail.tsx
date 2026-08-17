import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { memo, useCallback, useState } from "react";
import { css, cx } from "../../styled-system/css";
import { hstack, stack } from "../../styled-system/patterns";

import { Button } from "../Button/Button";

/** Which side of a drop target a dragged tab lands on. */
export type DropPosition = "before" | "after";

/** One tab in the rail: its stable `id`, the `label` naming it, and whether it
 *  shows a close button (defaults to closable). */
export type TabRailTab = {
  id: string;
  label: string;
  closable?: boolean | undefined;
};

type Props = {
  tabs: readonly TabRailTab[];
  /** The `id` of the active tab. */
  activeId: string;
  /** Make the tab `id` active — a view concern. */
  onSelect: (id: string) => void;
  /** Close the tab `id`. */
  onClose: (id: string) => void;
  /** Move the tab `fromId` to just before/after the tab `toId`. */
  onReorder: (fromId: string, toId: string, position: DropPosition) => void;
  /** Open a fresh tab (the built-in new-tab button). */
  onNew: () => void;
  /** App chrome framed in the header beside the new-tab button (a wordmark). */
  brand?: ReactNode | undefined;
  /** App chrome framed at the foot (a history / settings / theme row). */
  footer?: ReactNode | undefined;
};

/**
 * A vertical rail of tabs — the sidebar shape the horizontal {@link Tabs} bar
 * deliberately doesn't cover. Presentational: it owns the layout, styling, and
 * interaction (drag and keyboard reorder, active/hover/drag affordances) and
 * reports actions through callbacks; it holds no application state and reads no
 * context, so the same rail drives a workspace, a file tree, or a playlist.
 *
 * Each `tabs` entry is a row: a label control that selects the tab (`onSelect`)
 * and, unless `closable` is `false`, a close button (`onClose`). Rows reorder by
 * drag or by Alt+Up / Alt+Down (switch) and Alt+Shift+Up / Alt+Shift+Down
 * (rearrange) on a focused row. The header pairs the app's `brand` with a built-in
 * new-tab button (`onNew`); the `footer` frames app chrome at the foot.
 *
 * The close and new-tab controls are the shared {@link Button} (icon-only,
 * ghost). The tab-select control stays a purpose-built element: it needs the
 * `aria-current` "selected" styling and single-line truncation of a nav item,
 * neither of which `Button` exposes — and `className` is private, so it can't be
 * styled from outside.
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
  // Which tab is mid-drag — local view state for the drag affordance. The
  // reorder itself is the caller's (reported through `onReorder`).
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

  // Keyboard tab management on a focused row: Alt+Up / Alt+Down switch to the
  // neighbouring tab (moving focus with it), Alt+Shift+Up / Alt+Shift+Down
  // rearrange the row past that neighbour — the counterparts to click and drag.
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
      const neighbour = tabs[index + delta];
      if (current === undefined || neighbour === undefined) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        onReorder(current.id, neighbour.id, delta < 0 ? "before" : "after");
      } else {
        onSelect(neighbour.id);
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
 * One tab row: a label button that selects it and a close button that drops it
 * (unless `closable` is false). The row is the drag/keyboard reorder affordance —
 * it owns the pointer plumbing and calls the handlers with tab ids, so the parent
 * stays free of DOM-event details.
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

/** Which half of the row the cursor is over — where a dropped tab lands. */
const dropPosition = (event: DragEvent<HTMLLIElement>): DropPosition => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
};

/** After a keyboard switch, move focus to the neighbouring tab's button so a
 *  held Alt+Arrow keeps walking the rail. */
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
  // A fixed rail width; `flexShrink: 0` keeps it from compressing when framed
  // beside a flexible content region.
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

// Hover feedback, applied only when no drag is in progress so a highlight chasing
// the cursor doesn't obscure the rows reordering underneath it.
const rowHoverStyles = css({
  _hover: { backgroundColor: "card", color: "foreground" },
});

// The active tab: a brighter label and a subtle fill, keyed off the select
// button's `aria-current`. The attribute selector outweighs the base `muted`
// color, so the active tab stays bright whether or not it's hovered.
const rowActiveStyles = css({
  "&:has([aria-current=page])": {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 8%, {colors.background})",
    color: "foreground",
  },
});

// Fades the row while it's the one being dragged.
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
