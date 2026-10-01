import type { ToastObject } from "@base-ui/react/toast";
import { Toast as BaseToast } from "@base-ui/react/toast";
import type { CSSProperties, ReactNode } from "react";
import { css } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";

export const { createToastManager, useToastManager } = BaseToast;

/** A manager held outside React, which `Toaster.Provider` takes. */
export type ToastManager = ReturnType<typeof createToastManager>;

/** What a toast may be marked as, which the stylesheet draws differently. */
export const TYPES = ["danger"] as const;
export type Type = (typeof TYPES)[number];

type Props<Data extends object> = ExtendProps<
  typeof BaseToast.Viewport,
  {
    /**
     * What one toast says. The toaster draws the card, the stack and the
     * countdown; what is on the card is the caller's, and it is handed the
     * toast the manager holds — `title`, `description`, `data` and the rest.
     */
    children: (toast: ToastObject<Data>) => ReactNode;
    /** What the region the toasts are in is called, to a screen reader. */
    label: string;
  }
>;

/**
 * Toasts: short-lived cards stacked in the top trailing corner of whatever box
 * it is put in, which the caller places.
 *
 * **A deck, not a list.** The newest is in front and the rest peek out from
 * behind it, a little smaller each; pointing at the stack (or focusing it) fans
 * it out so every card can be read, and base-ui holds every timer while it is.
 * A card slides in from the trailing edge, and a swipe toward that edge — or
 * up, out of the way — puts it away.
 *
 * **What a toast says is the caller's**, through `children`; this owns the
 * card it is said on. `Toaster.Title` and `Toaster.Description` are the parts
 * that name the toast to a screen reader, and draw as plain text in whatever
 * the caller's own markup styles them as.
 *
 * A toast with a `timeout` above zero carries a hairline along its foot that
 * runs out with it, and stops while the stack is fanned out because the timer
 * does. One of `type: "danger"` is drawn in the danger color.
 *
 * Wraps base-ui's Toast, so `Toaster.Provider` and the manager are base-ui's:
 * `createToastManager()` for one held outside React, `useToastManager()` inside
 * the provider.
 */
const ToasterComponent = <Data extends object>({
  children,
  label,
  ...viewportProps
}: Props<Data>) => {
  const { toasts } = useToastManager<Data>();
  return (
    <BaseToast.Viewport
      aria-label={label}
      className={viewportStyles}
      {...viewportProps}
    >
      {toasts.map((toast) => (
        <BaseToast.Root
          className={rootStyles}
          data-toast=""
          key={toast.id}
          swipeDirection={["right", "up"]}
          toast={toast}
        >
          <BaseToast.Content className={contentStyles}>
            {children(toast)}
          </BaseToast.Content>
          {toast.timeout !== undefined && toast.timeout > 0 && (
            <span
              aria-hidden
              className={countdownStyles}
              data-toast-countdown=""
              // The one value here that is not a token, because it is not a
              // decision: the hairline runs out exactly when the toast does.
              style={
                { "--toast-timeout": `${toast.timeout}ms` } as CSSProperties
              }
            />
          )}
        </BaseToast.Root>
      ))}
    </BaseToast.Viewport>
  );
};

/** The toast's title, as plain text for the caller's markup to style. */
const Title = (props: ExtendProps<typeof BaseToast.Title, object>) => (
  <BaseToast.Title render={<span />} {...props} />
);

/** The toast's description, as plain text for the caller's markup to style. */
const Description = (
  props: ExtendProps<typeof BaseToast.Description, object>,
) => <BaseToast.Description render={<span />} {...props} />;

export const Toaster = Object.assign(ToasterComponent, {
  Description,
  Provider: BaseToast.Provider,
  Title,
});

// The stack's own box: as wide as a card, in the top trailing corner of the
// box the caller put it in, and above the page but under any modal panel —
// a toast over an open dialog would be drawn over the thing being answered.
const viewportStyles = css({
  inlineSize: "min({spacing.96}, 100%)",
  insetBlockStart: 0,
  insetInlineEnd: 0,
  outlineStyle: "none",
  position: "absolute",
  zIndex: "toast",
});

// One card of the deck.
//
// THE STACK IS CUSTOM PROPERTIES, which base-ui sets on every card: its place
// in the deck (`--toast-index`, the front one 0), how far down it sits when the
// deck is fanned out (`--toast-offset-y`), and how far a swipe has dragged it.
// Collapsed, each card behind the front one is shrunk a tenth more and peeks a
// step below it, clamped to the front card's height so the deck is as tall as
// one card; fanned out, every card sits at its own height, a gap apart.
const rootStyles = css({
  // A bridge across the gap under a fanned-out card, so moving the pointer
  // from one card to the next does not leave the stack and fold it.
  _after: {
    blockSize: "calc(var(--gap) + 1px)",
    content: '""',
    insetBlockStart: "100%",
    insetInline: 0,
    position: "absolute",
  },
  _focusVisible: {
    outlineColor: "accent",
  },
  "--gap": "{spacing.2.5}",
  "--height": "var(--toast-frontmost-height, var(--toast-height))",
  "--offset-y":
    "calc(var(--toast-offset-y) + var(--toast-index) * var(--gap) + var(--toast-swipe-movement-y))",
  "--peek": "{spacing.2.5}",
  "--scale": "calc(max(0, 1 - var(--toast-index) * 0.06))",
  "--shrink": "calc(1 - var(--scale))",
  "&[data-ending-style]": {
    opacity: 0,
  },
  // Out the way it came in, unless it was swiped: then on in the direction of
  // the swipe, from wherever the finger let go.
  "&[data-ending-style]:not([data-swipe-direction])": {
    transform:
      "translateX(calc(100% + {spacing.6})) translateY(var(--offset-y))",
  },
  "&[data-ending-style][data-swipe-direction=right]": {
    transform:
      "translateX(calc(var(--toast-swipe-movement-x) + 100% + {spacing.6})) translateY(var(--offset-y))",
  },
  "&[data-ending-style][data-swipe-direction=up]": {
    transform: "translateY(calc(var(--toast-swipe-movement-y) - 150%))",
  },
  "&[data-expanded]": {
    blockSize: "var(--toast-height)",
    transform:
      "translateX(var(--toast-swipe-movement-x)) translateY(var(--offset-y))",
  },
  // Past the provider's `limit`: still mounted, so it can leave gracefully,
  // and not shown.
  "&[data-limited]": {
    opacity: 0,
  },
  // In from beyond the trailing edge.
  "&[data-starting-style]": {
    transform: "translateX(calc(100% + {spacing.6}))",
  },
  "&[data-type=danger]": {
    borderColor: "color-mix(in oklab, {colors.danger} 55%, transparent)",
    boxShadow:
      "{shadows.lifted}, 0 0 0 1px color-mix(in oklab, {colors.danger} 25%, transparent)",
  },
  backdropFilter: "blur({spacing.4})",
  backgroundColor: "color-mix(in oklab, {colors.card} 80%, transparent)",
  blockSize: "var(--height)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 12%, transparent)",
  borderRadius: "2xl",
  boxShadow: "lifted",
  boxSizing: "border-box",
  color: "foreground",
  cursor: "default",
  inlineSize: "100%",
  insetBlockStart: 0,
  insetInlineEnd: 0,
  overflow: "hidden",
  position: "absolute",
  transform:
    "translateX(var(--toast-swipe-movement-x)) translateY(calc(var(--toast-swipe-movement-y) + var(--toast-index) * var(--peek) + var(--shrink) * var(--height))) scale(var(--scale))",
  transformOrigin: "top center",
  transition:
    "transform {durations.slow} {easings.outQuart}, opacity {durations.slow} {easings.outQuart}, height {durations.fast} {easings.out}",
  userSelect: "none",
  zIndex: "calc(1000 - var(--toast-index))",
});

// A card behind the front one has the front one's height while the deck is
// folded, so what it says would be cut off half way: it fades out until the
// deck fans open, and back in when it does.
const contentStyles = css({
  "&[data-behind]": {
    opacity: 0,
  },
  "&[data-expanded]": {
    opacity: 1,
  },
  transition: "opacity {durations.normal} {easings.outQuart}",
});

// The hairline along the foot of a card that runs out with its timer. It
// stops while the deck is fanned out, which is exactly when base-ui holds the
// timer, so the two agree. It runs out toward the leading edge and brightens
// toward the trailing one, the corner the card came in from: physical
// `left`/`to right` because `linear-gradient` and `transform-origin` have no
// logical keywords, and a desk is drawn left to right.
const countdownStyles = css({
  // Only the front card's shows while the deck is folded: the others' would
  // be lines peeking out from under it, saying nothing anyone can read.
  "[data-behind] ~ &": {
    opacity: 0,
  },
  "[data-expanded] > &": {
    animationPlayState: "paused",
  },
  "[data-type=danger] > &": {
    backgroundImage: "linear-gradient(to right, transparent, {colors.danger})",
  },
  animationDuration: "var(--toast-timeout)",
  animationFillMode: "forwards",
  animationName: "toastCountdown",
  animationTimingFunction: "linear",
  backgroundImage: "linear-gradient(to right, transparent, {colors.accent})",
  blockSize: 0.5,
  insetBlockEnd: 0,
  insetInline: 0,
  position: "absolute",
  transformOrigin: "left",
  transition: "opacity {durations.normal} {easings.outQuart}",
});
