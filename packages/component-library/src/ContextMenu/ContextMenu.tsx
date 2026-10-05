import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { css } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";

/** A point in the viewport, in CSS pixels. */
export type Point = { x: number; y: number };

type Props = ExtendProps<
  typeof BaseMenu.Root,
  {
    /** Where the menu opens: its top left corner, unless that would not fit. */
    at: Point;
    children: ReactNode;
    /** What the menu is called, to assistive technology. */
    label: string;
  }
>;

/**
 * A menu opened at a point, such as a right click's, with no trigger element.
 *
 * The caller sets `open` and `at`, and hears it close (a choice, Escape or an
 * outside press) through `onOpenChange`. The press may not be in this
 * document, as with a click in a `<webview>`. The menu takes the keyboard while
 * open.
 */
const ContextMenuComponent = ({ at, children, label, ...rootProps }: Props) => {
  // A zero-size box at the point, for the positioner to align the menu's
  // corner with.
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ height: 0, width: 0, x: at.x, y: at.y }),
    }),
    [at.x, at.y],
  );
  return (
    <BaseMenu.Root {...rootProps}>
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          align="start"
          anchor={anchor}
          className={positionerStyles}
          side="bottom"
          sideOffset={0}
        >
          <BaseMenu.Popup aria-label={label} className={popupStyles}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
};

type ItemProps = ExtendProps<
  typeof BaseMenu.Item,
  {
    children: ReactNode;
    /** The keys that do the same, shown at the item's end. */
    shortcut?: string | undefined;
  }
>;

/** One thing the menu can do. Closes the menu when chosen. */
const Item = ({ children, shortcut, ...itemProps }: ItemProps) => (
  <BaseMenu.Item className={itemStyles} {...itemProps}>
    <span className={labelStyles}>{children}</span>
    {shortcut !== undefined && (
      <span className={shortcutStyles}>{shortcut}</span>
    )}
  </BaseMenu.Item>
);

/** A line between groups of items. */
const Separator = () => <BaseMenu.Separator className={separatorStyles} />;

export const ContextMenu = Object.assign(ContextMenuComponent, {
  Item,
  Separator,
});

const positionerStyles = css({
  outlineStyle: "none",
  zIndex: "modal",
});

// `&[data-starting-style]` rather than Panda's `_starting`: `@starting-style`
// does not reliably fire for a portaled popup. See `Popover`.
const popupStyles = css({
  "&[data-ending-style]": {
    opacity: 0,
    transition: "opacity {durations.fast} {easings.in}",
  },
  "&[data-starting-style]": {
    opacity: 0,
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  color: "foreground",
  display: "flex",
  flexDirection: "column",
  maxBlockSize: "var(--available-height)",
  minInlineSize: "{spacing.56}",
  opacity: 1,
  outlineStyle: "none",
  overflowY: "auto",
  paddingBlock: 1,
  transition: "opacity {durations.fast} {easings.out}",
});

// `Select`'s item, with a shortcut where its check would be.
const itemStyles = css({
  "&[data-disabled]": {
    color: "muted",
    opacity: "disabled",
  },
  "&[data-highlighted]": {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, transparent)",
  },
  alignItems: "center",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "pointer" },
  display: "grid",
  fontSize: "sm",
  gap: 6,
  gridTemplateColumns: "1fr auto",
  outlineStyle: "none",
  paddingBlock: 1.5,
  paddingInline: 3,
  userSelect: "none",
});

const labelStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const shortcutStyles = css({
  color: "muted",
  fontSize: "xs",
});

const separatorStyles = css({
  backgroundColor: "border",
  blockSize: "1px",
  marginBlock: 1,
});
