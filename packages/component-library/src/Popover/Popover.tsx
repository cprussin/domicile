import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";
import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

export const { createHandle } = BasePopover;

/** Which side of its trigger the panel opens on. */
export const SIDES = ["top", "bottom", "inline-start", "inline-end"] as const;
export type Side = (typeof SIDES)[number];

/** Where the panel lines up along that side. */
export const ALIGNMENTS = ["start", "center", "end"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

type Props = ExtendProps<
  typeof BasePopover.Root,
  {
    align?: Alignment | undefined;
    children: ReactNode;
    side?: Side | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
  }
>;

/**
 * A panel anchored to the control that opened it, for detail the control has
 * no room for — what an indicator means, what a value is made of.
 *
 * No notch pointing back at the trigger. base-ui offers one, and what it buys
 * is a tie the eye already makes: the panel opens against the control, eight
 * pixels under it, while the control is still lit. Chromium's own site
 * information bubble has none, and neither does the `Select` popup here.
 *
 * Non-modal: the page behind it stays scrollable and clickable, and pressing
 * outside or Escape closes it. That is the difference between this and
 * `ModalDialog`, which is for something the user has to answer before carrying
 * on.
 */
const PopoverComponent = ({
  align = "center",
  children,
  side = "bottom",
  title,
  trigger,
  ...rootProps
}: Props) => (
  <BasePopover.Root {...rootProps}>
    {trigger !== undefined && <BasePopover.Trigger render={trigger} />}
    <BasePopover.Portal>
      <BasePopover.Positioner
        align={align}
        className={positionerStyles}
        side={side}
        sideOffset={8}
      >
        <BasePopover.Popup className={popupStyles}>
          {title !== undefined && (
            <BasePopover.Title className={titleStyles}>
              {title}
            </BasePopover.Title>
          )}
          <div className={bodyStyles({ hasTitle: title !== undefined })}>
            {children}
          </div>
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  </BasePopover.Root>
);

/**
 * `Close` for a panel that needs a button to dismiss it. The panel closes on
 * an outside press and on Escape without one, so most do not.
 */
export const Popover = Object.assign(PopoverComponent, {
  Close: BasePopover.Close,
});

const positionerStyles = css({
  outlineStyle: "none",
  zIndex: "modal",
});

const popupStyles = flex({
  "&[data-ending-style]": {
    opacity: 0,
    transform: "scale(0.96)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  // `&[data-starting-style]` rather than Panda's `_starting`: base-ui sets and
  // clears the attribute itself, and the browser's `@starting-style` does not
  // reliably fire for an element that mounts inside a portal — which leaves
  // the panel snapped into place with no animation. Same trade `Select` makes.
  "&[data-starting-style]": {
    opacity: 0,
    transform: "scale(0.96)",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "lifted",
  color: "foreground",
  direction: "column",
  maxInlineSize: "min({spacing.88}, 90vw)",
  opacity: 1,
  outlineStyle: "none",
  paddingBlock: 3,
  paddingInline: 3.5,
  transform: "scale(1)",
  transformOrigin: "var(--transform-origin)",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.out}",
});

const titleStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  lineHeight: "snug",
  margin: 0,
});

const bodyStyles = cva({
  base: {
    color: "muted",
    display: "flex",
    flexDirection: "column",
    fontSize: "xs",
    gap: 2,
    lineHeight: "normal",
  },
  variants: {
    hasTitle: {
      false: { paddingBlockStart: 0 },
      true: { paddingBlockStart: 1.5 },
    },
  },
});
