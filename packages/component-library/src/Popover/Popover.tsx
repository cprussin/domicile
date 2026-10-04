import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { useStableRef } from "../_control/useStableRef";
import type { ExtendProps } from "../extend-props";

export const { createHandle } = BasePopover;

/** Which side of its trigger the panel opens on. */
export const SIDES = ["top", "bottom", "inline-start", "inline-end"] as const;
export type Side = (typeof SIDES)[number];

/** Where the panel lines up along that side. */
export const ALIGNMENTS = ["start", "center", "end"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const TONES = ["card", "overPhoto"] as const;
export type Tone = (typeof TONES)[number];

type Props = ExtendProps<
  typeof BasePopover.Root,
  {
    align?: Alignment | undefined;
    children: ReactNode;
    /**
     * Drop the panel's padding and width cap, for a body that is a surface of
     * its own — a view of another page — which the padding would only frame.
     */
    flush?: boolean | undefined;
    side?: Side | undefined;
    title?: ReactNode | undefined;
    /**
     * `overPhoto` is a translucent pill lettered white, for a panel hanging off
     * a bar drawn straight onto the wallpaper: it reads as part of the bar
     * rather than as a card dropped onto it.
     */
    tone?: Tone | undefined;
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
 * outside or Escape closes it — and so does focus moving anywhere outside it,
 * which is all this document hears of a press inside a frame of another
 * process. That is the difference between this and
 * `ModalDialog`, which is for something the user has to answer before carrying
 * on.
 */
const PopoverComponent = ({
  actionsRef,
  align = "center",
  children,
  flush = false,
  side = "bottom",
  title,
  tone = "card",
  trigger,
  ...rootProps
}: Props) => {
  const ownActions = useRef<BasePopover.Root.Actions | null>(null);
  const actions = actionsRef ?? ownActions;
  const [popupRef, setPopupRef] = useStableRef<HTMLDivElement>();
  const [triggerRef, setTriggerRef] = useStableRef<HTMLElement>();
  return (
    <BasePopover.Root actionsRef={actions} {...rootProps}>
      {trigger !== undefined && (
        <BasePopover.Trigger ref={setTriggerRef} render={trigger} />
      )}
      <BasePopover.Portal>
        <BasePopover.Positioner
          align={align}
          className={positionerStyles}
          side={side}
          sideOffset={tone === "overPhoto" ? 6 : 8}
        >
          <BasePopover.Popup
            className={popupStyles}
            data-flush={flush ? "" : undefined}
            data-tone={tone}
            ref={setPopupRef}
          >
            <CloseOnFocusOut
              actions={actions}
              popup={popupRef}
              trigger={triggerRef}
            />
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
};

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
  // Clipped, so the body's own corners follow the panel's.
  "&[data-flush]": {
    maxInlineSize: "90vw",
    overflow: "hidden",
    paddingBlock: 0,
    paddingInline: 0,
  },
  // `&[data-starting-style]` rather than Panda's `_starting`: base-ui sets and
  // clears the attribute itself, and the browser's `@starting-style` does not
  // reliably fire for an element that mounts inside a portal — which leaves
  // the panel snapped into place with no animation. Same trade `Select` makes.
  "&[data-starting-style]": {
    opacity: 0,
    transform: "scale(0.96)",
  },
  // A frosted pill lettered white over any photo: the bar's language rather
  // than a card's, and the same in both themes, since the wallpaper does not
  // flip with them. A pill while it is one row — the radius is half a row's
  // height, as the bar's own chips are — and a rounded panel once its content
  // is taller, rather than a stadium.
  "&[data-tone=overPhoto]": {
    backdropFilter: "blur({spacing.3})",
    backgroundColor: "panelOverPhoto",
    border: "none",
    borderRadius: "2xl",
    color: "onPhoto",
    paddingBlock: 1.5,
    paddingInline: 3,
    textShadow: "textOverPhoto",
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
    "[data-tone=overPhoto] > &": {
      color: "inherit",
    },
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

/**
 * Close the open panel when focus lands outside it and its trigger. Mounted
 * inside the popup, so it listens only while the panel is open.
 */
const CloseOnFocusOut = ({
  actions,
  popup,
  trigger,
}: {
  actions: RefObject<BasePopover.Root.Actions | null>;
  popup: RefObject<HTMLDivElement | null>;
  trigger: RefObject<HTMLElement | null>;
}) => {
  useEffect(() => {
    const left = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        popup.current?.contains(target) !== true &&
        trigger.current?.contains(target) !== true
      ) {
        actions.current?.close();
      }
    };
    document.addEventListener("focusin", left);
    return () => {
      document.removeEventListener("focusin", left);
    };
  }, [actions, popup, trigger]);
  return undefined;
};
