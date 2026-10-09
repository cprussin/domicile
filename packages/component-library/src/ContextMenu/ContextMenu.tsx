import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { DotIcon } from "@phosphor-icons/react/dist/ssr/Dot";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { css } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";

/** A point in the viewport, in CSS pixels. */
export type Point = { x: number; y: number };

type Props = ExtendProps<
  typeof BaseContextMenu.Root,
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
    // The context menu's root, not `Menu.Root`: a `Menu.Root` with no trigger
    // closes when one of its submenus opens.
    <BaseContextMenu.Root {...rootProps}>
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
    </BaseContextMenu.Root>
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

type CheckboxItemProps = ExtendProps<
  typeof BaseMenu.CheckboxItem,
  { children: ReactNode }
>;

/** An item with a check mark that shows whether it is on. */
const CheckboxItem = ({ children, ...itemProps }: CheckboxItemProps) => (
  <BaseMenu.CheckboxItem className={itemStyles} {...itemProps}>
    <span className={labelStyles}>{children}</span>
    <BaseMenu.CheckboxItemIndicator className={indicatorStyles}>
      <CheckIcon />
    </BaseMenu.CheckboxItemIndicator>
  </BaseMenu.CheckboxItem>
);

/** Radio items, of which the one whose `value` is the group's is chosen. */
const RadioGroup = BaseMenu.RadioGroup;

type RadioItemProps = ExtendProps<
  typeof BaseMenu.RadioItem,
  { children: ReactNode }
>;

/** One choice in a `RadioGroup`, with a dot when chosen. */
const RadioItem = ({ children, ...itemProps }: RadioItemProps) => (
  <BaseMenu.RadioItem className={itemStyles} {...itemProps}>
    <span className={labelStyles}>{children}</span>
    <BaseMenu.RadioItemIndicator className={indicatorStyles}>
      <DotIcon weight="bold" />
    </BaseMenu.RadioItemIndicator>
  </BaseMenu.RadioItem>
);

type SubmenuProps = ExtendProps<
  typeof BaseMenu.SubmenuRoot,
  {
    children: ReactNode;
    disabled?: boolean | undefined;
    /** The text of the item that opens it, and the submenu's name. */
    label: string;
  }
>;

/** An item that opens a menu of `children` beside it. */
const Submenu = ({ children, disabled, label, ...rootProps }: SubmenuProps) => (
  <BaseMenu.SubmenuRoot {...rootProps}>
    <BaseMenu.SubmenuTrigger className={itemStyles} disabled={disabled}>
      <span className={labelStyles}>{label}</span>
      <CaretRightIcon className={caretStyles} />
    </BaseMenu.SubmenuTrigger>
    <BaseMenu.Portal>
      <BaseMenu.Positioner className={positionerStyles}>
        <BaseMenu.Popup aria-label={label} className={popupStyles}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  </BaseMenu.SubmenuRoot>
);

/** A line between groups of items. */
const Separator = () => <BaseMenu.Separator className={separatorStyles} />;

export const ContextMenu = Object.assign(ContextMenuComponent, {
  CheckboxItem,
  Item,
  RadioGroup,
  RadioItem,
  Separator,
  Submenu,
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

// `Select`'s item. Its end holds a shortcut, check, dot or caret.
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

// `Select`'s check.
const indicatorStyles = css({
  alignItems: "center",
  color: "accent",
  display: "inline-flex",
  flexShrink: 0,
});

const caretStyles = css({ color: "muted" });

const separatorStyles = css({
  backgroundColor: "border",
  blockSize: "1px",
  marginBlock: 1,
});
