import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode, RefCallback, RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { useStableRef } from "../_control/useStableRef";
import type { ExtendProps } from "../extend-props";

export const { createHandle } = BasePopover;

/**
 * Where popovers inside draw their panels; the page's body without one. For a
 * layer above `modal`, such as a lock screen, whose panels must draw over it.
 */
export const PopoverContainer = createContext<HTMLElement | undefined>(
  undefined,
);

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
     * Drop the panel's padding and width cap, for content that is its own
     * surface, such as an embedded page.
     */
    flush?: boolean | undefined;
    side?: Side | undefined;
    title?: ReactNode | undefined;
    /**
     * `overPhoto` is a translucent pill with white text, for panels opened
     * from a bar drawn over the wallpaper.
     */
    tone?: Tone | undefined;
    trigger?: ReactElement | undefined;
    /**
     * A wider cap, for a panel of controls whose names would otherwise be
     * cut short — a mixer's devices, say.
     */
    wide?: boolean | undefined;
  }
>;

/**
 * A non-modal panel anchored to its trigger, for detail the trigger has no
 * room for. Use `ModalDialog` when the user must respond first.
 *
 * Stays on its trigger's `<Screen>` region, so on a desktop of several
 * monitors it never spans two.
 *
 * Closes on an outside press, Escape, or focus leaving it. The focus check
 * catches presses inside out-of-process frames, which the document can't
 * see. Portaled content such as a `Select` list counts as inside.
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
  wide = false,
  ...rootProps
}: Props) => {
  const ownActions = useRef<BasePopover.Root.Actions | null>(null);
  const actions = actionsRef ?? ownActions;
  const [popupRef, setPopupRef] = useStableRef<HTMLDivElement>();
  const [triggerRef, setTriggerRef] = useStableRef<HTMLElement>();
  const [screen, setScreen] = useState<Element | undefined>(undefined);
  const attachTrigger = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      setScreen(element?.closest("[data-screen]") ?? undefined);
      return setTriggerRef(element);
    },
    [setTriggerRef],
  );
  const within = useRef<FocusEvent | undefined>(undefined);
  const container = useContext(PopoverContainer);
  return (
    <BasePopover.Root actionsRef={actions} {...rootProps}>
      {trigger !== undefined && (
        <BasePopover.Trigger ref={attachTrigger} render={trigger} />
      )}
      <BasePopover.Portal container={container}>
        <BasePopover.Positioner
          align={align}
          className={positionerStyles}
          collisionBoundary={screen}
          onFocus={(event) => {
            within.current = event.nativeEvent;
          }}
          side={side}
          sideOffset={tone === "overPhoto" ? 6 : 8}
        >
          <BasePopover.Popup
            className={popupStyles}
            data-flush={flush ? "" : undefined}
            data-tone={tone}
            data-wide={wide ? "" : undefined}
            ref={setPopupRef}
          >
            <CloseOnFocusOut
              actions={actions}
              popup={popupRef}
              trigger={triggerRef}
              within={within}
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
 * A close button, for panels that need one besides outside press and Escape.
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
  // Clips content to the panel's rounded corners.
  "&[data-flush]": {
    maxInlineSize: "90vw",
    overflow: "hidden",
    paddingBlock: 0,
    paddingInline: 0,
  },
  // base-ui's attribute instead of Panda's `_starting`: `@starting-style`
  // does not reliably fire for elements mounted in a portal.
  "&[data-starting-style]": {
    opacity: 0,
    transform: "scale(0.96)",
  },
  // The same in both themes, since the wallpaper doesn't change with them.
  // The radius is half a row's height: a pill for one row, a rounded panel
  // for more.
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
  "&[data-wide]": {
    maxInlineSize: "min(30rem, 90vw)",
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
 * Closes the panel when focus leaves it and its trigger. Mounted inside the
 * popup, so it listens only while open.
 *
 * Portaled content counts as inside: React focus events follow the component
 * tree and reach `within` before the document sees them.
 */
const CloseOnFocusOut = ({
  actions,
  popup,
  trigger,
  within,
}: {
  actions: RefObject<BasePopover.Root.Actions | null>;
  popup: RefObject<HTMLDivElement | null>;
  trigger: RefObject<HTMLElement | null>;
  within: RefObject<FocusEvent | undefined>;
}) => {
  useEffect(() => {
    const left = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        event !== within.current &&
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
  }, [actions, popup, trigger, within]);
  return undefined;
};
