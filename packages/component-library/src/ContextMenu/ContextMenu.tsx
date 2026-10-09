import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { BaseUIEvent } from "@base-ui/react/types";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { DotIcon } from "@phosphor-icons/react/dist/ssr/Dot";
import type { KeyboardEvent, ReactNode } from "react";
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
 *
 * A letter chooses the first enabled item in the open menu or submenu whose
 * mnemonic it is, and opens a submenu. Other letters go to base-ui's
 * type-ahead, which highlights the next item whose label starts with them.
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
          <BaseMenu.Popup
            aria-label={label}
            className={popupStyles}
            onKeyDown={chooseByMnemonic}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseContextMenu.Root>
  );
};

/**
 * An item's label and the icon before it. In a menu where any item has an
 * icon, every label leaves room for one, so labels line up.
 */
type Content = {
  /** Drawn before the label, at the size of a line of text. */
  icon?: ReactNode | undefined;
} & (
  | { children: ReactNode; mnemonic?: undefined }
  | {
      children: string;
      /**
       * Where in the label the access key is. It is underlined, and its key
       * chooses the item.
       */
      mnemonic?: number | undefined;
    }
);

type ItemProps = ExtendProps<
  typeof BaseMenu.Item,
  Content & {
    /** The keys that do the same, shown at the item's end. */
    shortcut?: string | undefined;
  }
>;

/** One thing the menu can do. Closes the menu when chosen. */
const Item = ({
  children,
  icon,
  mnemonic,
  shortcut,
  ...itemProps
}: ItemProps) => (
  <BaseMenu.Item
    className={itemStyles}
    data-mnemonic={mnemonicKey(children, mnemonic)}
    {...itemProps}
  >
    <Label icon={icon} mnemonic={mnemonic}>
      {children}
    </Label>
    {shortcut !== undefined && (
      <span className={shortcutStyles}>{shortcut}</span>
    )}
  </BaseMenu.Item>
);

type CheckboxItemProps = ExtendProps<typeof BaseMenu.CheckboxItem, Content>;

/** An item with a check mark that shows whether it is on. */
const CheckboxItem = ({
  children,
  icon,
  mnemonic,
  ...itemProps
}: CheckboxItemProps) => (
  <BaseMenu.CheckboxItem
    className={itemStyles}
    data-mnemonic={mnemonicKey(children, mnemonic)}
    {...itemProps}
  >
    <Label icon={icon} mnemonic={mnemonic}>
      {children}
    </Label>
    <BaseMenu.CheckboxItemIndicator className={indicatorStyles}>
      <CheckIcon />
    </BaseMenu.CheckboxItemIndicator>
  </BaseMenu.CheckboxItem>
);

/** Radio items, of which the one whose `value` is the group's is chosen. */
const RadioGroup = BaseMenu.RadioGroup;

type RadioItemProps = ExtendProps<typeof BaseMenu.RadioItem, Content>;

/** One choice in a `RadioGroup`, with a dot when chosen. */
const RadioItem = ({
  children,
  icon,
  mnemonic,
  ...itemProps
}: RadioItemProps) => (
  <BaseMenu.RadioItem
    className={itemStyles}
    data-mnemonic={mnemonicKey(children, mnemonic)}
    {...itemProps}
  >
    <Label icon={icon} mnemonic={mnemonic}>
      {children}
    </Label>
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
    /** Drawn before the label, as on {@link Item}. */
    icon?: ReactNode | undefined;
    /** The text of the item that opens it, and the submenu's name. */
    label: string;
    /** Where in `label` the access key is, as on {@link Item}. */
    mnemonic?: number | undefined;
  }
>;

/** An item that opens a menu of `children` beside it. */
const Submenu = ({
  children,
  disabled,
  icon,
  label,
  mnemonic,
  ...rootProps
}: SubmenuProps) => (
  <BaseMenu.SubmenuRoot {...rootProps}>
    <BaseMenu.SubmenuTrigger
      className={itemStyles}
      data-mnemonic={mnemonicKey(label, mnemonic)}
      disabled={disabled}
    >
      <Label icon={icon} mnemonic={mnemonic}>
        {label}
      </Label>
      <CaretRightIcon className={caretStyles} />
    </BaseMenu.SubmenuTrigger>
    <BaseMenu.Portal>
      <BaseMenu.Positioner className={positionerStyles}>
        <BaseMenu.Popup
          aria-label={label}
          className={popupStyles}
          onKeyDown={chooseByMnemonic}
        >
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
  "&:has([data-item-icon]:not(:empty)) [data-item-icon]": {
    display: "inline-flex",
  },
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
  alignItems: "center",
  display: "flex",
  gap: 2,
  minInlineSize: 0,
});

// Hidden unless the popup has an icon; see `popupStyles`.
const iconStyles = css({
  "& > *": { blockSize: "100%", inlineSize: "100%" },
  alignItems: "center",
  blockSize: 4,
  display: "none",
  flexShrink: 0,
  inlineSize: 4,
  justifyContent: "center",
});

const textStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const mnemonicStyles = css({ textDecoration: "underline" });

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

type LabelProps = {
  children: ReactNode;
  icon: ReactNode;
  mnemonic: number | undefined;
};

/**
 * An item's icon slot, then its label with the mnemonic underlined. `Content`
 * allows a mnemonic only on a text label.
 */
const Label = ({ children, icon, mnemonic }: LabelProps) => (
  <span className={labelStyles}>
    <span className={iconStyles} data-item-icon="">
      {icon}
    </span>
    <span className={textStyles}>
      {typeof children === "string" && mnemonic !== undefined ? (
        <>
          {children.slice(0, mnemonic)}
          <span className={mnemonicStyles}>{children.charAt(mnemonic)}</span>
          {children.slice(mnemonic + 1)}
        </>
      ) : (
        children
      )}
    </span>
  </span>
);

/** The key, in lower case, that chooses an item labeled `children`. */
const mnemonicKey = (
  children: ReactNode,
  mnemonic: number | undefined,
): string | undefined =>
  typeof children === "string" && mnemonic !== undefined
    ? children.charAt(mnemonic).toLocaleLowerCase()
    : undefined;

/**
 * Chooses the first enabled item in this popup whose mnemonic was pressed,
 * instead of base-ui's type-ahead. A key from a submenu bubbles here through
 * React's tree; that submenu's popup is not inside this one, so it is skipped.
 */
const chooseByMnemonic = (
  event: BaseUIEvent<KeyboardEvent<HTMLDivElement>>,
) => {
  const item = mnemonicItem(event);
  if (item !== undefined) {
    event.preventBaseUIHandler();
    event.preventDefault();
    item.click();
  }
};

/** The first enabled item in `event`'s popup whose mnemonic it pressed. */
const mnemonicItem = (
  event: KeyboardEvent<HTMLDivElement>,
): HTMLElement | undefined => {
  const popup = event.currentTarget;
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    !(event.target instanceof Node) ||
    !popup.contains(event.target)
  ) {
    return undefined;
  } else {
    return [...popup.querySelectorAll<HTMLElement>("[data-mnemonic]")].find(
      (candidate) =>
        candidate.dataset.mnemonic === event.key.toLocaleLowerCase() &&
        !candidate.hasAttribute("data-disabled"),
    );
  }
};
