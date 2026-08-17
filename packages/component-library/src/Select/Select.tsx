import { Select as BaseSelect } from "@base-ui/react/select";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import type { MouseEventHandler, ReactNode } from "react";
import { useRef, useState } from "react";
import { css, cva, cx } from "../../styled-system/css";
import type { ControlVariant } from "../../styled-system/recipes";
import { control } from "../../styled-system/recipes";
import { controlSizingStyle } from "../_control/controlSizingStyle";
import { focusControlOnMouseDown } from "../_control/focus";
import { PrefixIconStack } from "../_control/PrefixIconStack";
import { wrapperBase } from "../_control/wrapperBase";
import type { ExtendProps } from "../extend-props";

export { SIZES, type Size } from "../control-sizes";

/** A single option in the select popup. */
export type SelectOption<V> = {
  value: V;
  label: ReactNode;
  /**
   * Optional plain-text label used for keyboard text-search and for
   * rendering the value in the trigger when `value` is an object. Defaults
   * to `label` when `label` is a string; required otherwise.
   */
  textLabel?: string | undefined;
  disabled?: boolean | undefined;
};

type CommonProps<V> = Partial<ControlVariant> & {
  // `null` is base-ui's controlled-with-no-selection sentinel; `undefined`
  // means uncontrolled. We forward both verbatim so consumers can pick
  // either model without triggering the controlled/uncontrolled warning.
  defaultValue?: V | null | undefined;
  disabled?: boolean | undefined;
  options: readonly SelectOption<V>[];
  onValueChange?: ((value: V | null) => void) | undefined;
  placeholder?: ReactNode | undefined;
  prefixIcon?: ReactNode | undefined;
  required?: boolean | undefined;
  rounded?: boolean | undefined;
  value?: V | null | undefined;
  width?: number | undefined;
};

type Props<V> = ExtendProps<typeof BaseSelect.Trigger, CommonProps<V>>;

// The Select component composes the same `control` recipe + `wrapperBase`
// state matrix as Input/Textarea. The trigger button carries `data-control`
// so the wrapper's `:has([data-control]:disabled)` / `:focus-visible` /
// `[data-invalid]` selectors fire identically — the visual surface, focus
// outline, hover border, and invalid styling match the rest of the form
// controls verbatim. A right-aligned caret replaces the resize handle.
export const Select = <V,>({
  defaultValue,
  disabled,
  name,
  onValueChange,
  options,
  placeholder,
  prefixIcon,
  required,
  rounded = false,
  size = "md",
  value,
  width,
  ...triggerProps
}: Props<V>) => {
  const textLabelForOption = (option: SelectOption<V>): string =>
    option.textLabel ??
    (typeof option.label === "string" ? option.label : String(option.value));
  // `active` stays true for the *entire* open lifecycle — set on open,
  // cleared only after base-ui finishes the close animation and returns
  // focus to the trigger (`onOpenChangeComplete(false)`). The trigger
  // receives this as `data-active`; `wrapperBase`'s focused-state
  // selectors recognize it alongside `:focus` and `[data-popup-open]`.
  // Together those three signals form a continuous "looks focused"
  // window with no gap during close, so the wrapper never transitions
  // toward its unfocused appearance and there's nothing to flash.
  const [active, setActive] = useState(false);
  // Controlled open state, used to suppress an immediate re-open
  // sequence that fires when the user clicks the Field's label while
  // the popup is open:
  //   1. mousedown on label → base-ui's useDismiss (document-level,
  //      *capture* phase, default 'sloppy' outsidePressEvent) closes the
  //      popup before any label-level handler can run.
  //   2. click on label → browser dispatches a synthetic click on the
  //      trigger via the label's `htmlFor`.
  //   3. base-ui's useClick (configured `event: 'mousedown'`) reads
  //      `pointerType === undefined` for that synthetic click (no real
  //      pointerdown ever hit the trigger) and toggles → reopens.
  // The synthetic click in (2) fires synchronously inside the same
  // browser task as the mousedown in (1), so a lockout flag cleared on
  // the next macrotask via `setTimeout(0)` spans the entire sequence
  // without affecting real user interactions (a human can't click twice
  // inside a single task). When the lockout is set and base-ui asks to
  // open, we drop the request.
  const [open, setOpen] = useState(false);
  const reopenLockoutRef = useRef(false);
  const reopenLockoutTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  // base-ui's Positioner uses the trigger as its anchor by default, so
  // `--anchor-width` would be the trigger button's width (= wrapper
  // inner width minus paddings minus the prefix icon). Anchoring to the
  // wrapper instead makes `--anchor-width` equal the visible field's
  // outer width, which the popup then reads via `inlineSize:
  // var(--anchor-width)` so its width matches the field exactly.
  const wrapperRef = useRef<HTMLDivElement>(null);
  return (
    <BaseSelect.Root<V>
      defaultValue={defaultValue}
      disabled={disabled}
      itemToStringLabel={(itemValue) => {
        const match = options.find((option) =>
          Object.is(option.value, itemValue),
        );
        return match === undefined ? "" : textLabelForOption(match);
      }}
      name={name}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen && reopenLockoutRef.current) {
          // Cancel the open at base-ui's level so it doesn't update its
          // internal `openUnwrapped` state either. Returning silently
          // would also work for the controlled state we own, but cancel()
          // keeps base-ui's bookkeeping in sync.
          eventDetails.cancel();
          return;
        }
        if (!nextOpen) {
          reopenLockoutRef.current = true;
          if (reopenLockoutTimeoutRef.current !== undefined) {
            clearTimeout(reopenLockoutTimeoutRef.current);
          }
          // The synthetic click that the browser fires on the trigger via
          // the label's htmlFor lands a few browser tasks after the close.
          // Macrotask schedulers (`setTimeout(0)`) and microtasks can race
          // and clear before the synthetic click arrives — a fixed delay
          // comfortably longer than the click sequence avoids the race
          // and is still far shorter than human re-click latency (~200ms+).
          reopenLockoutTimeoutRef.current = setTimeout(() => {
            reopenLockoutRef.current = false;
            reopenLockoutTimeoutRef.current = undefined;
          }, 100);
        }
        setOpen(nextOpen);
        if (nextOpen) {
          setActive(true);
        }
      }}
      onOpenChangeComplete={(o) => {
        if (!o) {
          setActive(false);
        }
      }}
      onValueChange={(next) => {
        onValueChange?.(next);
      }}
      open={open}
      required={required}
      value={value}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: forwards wrapper-padding clicks to the trigger so the full container is the clickable target; mirrors native <label> behavior */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: forwards wrapper-padding clicks to the trigger so the full container is the clickable target; mirrors native <label> behavior */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the trigger button this onClick forwards to handles every keyboard interaction (Enter/Space to open, Esc to close, arrows to navigate); the wrapper onClick is a mouse-only convenience for click-anywhere-on-the-field */}
      <div
        className={cx(
          control({ size }),
          wrapperBase,
          wrapperStyles({ rounded, size }),
        )}
        onClick={openTriggerOnWrapperClick}
        onMouseDown={focusControlOnMouseDown}
        ref={wrapperRef}
        style={controlSizingStyle({ width })}
      >
        <PrefixIconStack prefixIcon={prefixIcon} size={size} />
        <BaseSelect.Trigger
          {...triggerProps}
          className={triggerStyles}
          data-active={active ? "" : undefined}
          data-control=""
        >
          <BaseSelect.Value placeholder={placeholder} />
          <BaseSelect.Icon className={caretStyles} render={<CaretDownIcon />} />
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Backdrop className={backdropStyles} />
        <BaseSelect.Positioner
          align="start"
          // `false` keeps the popup sitting cleanly below the field with
          // its left edge at the wrapper's left edge. base-ui's default
          // (`true`) shifts the popup horizontally to line up the popup
          // selected-item text with the trigger value text, which when
          // there's a prefix icon shifts the popup right past the
          // wrapper's edge — the popup ends up at the trigger button's
          // left, not the wrapper's left, so it no longer visually
          // "matches" the field.
          alignItemWithTrigger={false}
          // Anchor to the field's outer wrapper (not the inner trigger
          // button) so `--anchor-width` reflects the visible field width,
          // including paddings and prefix icon — read by the popup's
          // `inlineSize: var(--anchor-width)` to match the field exactly.
          anchor={wrapperRef}
          className={positionerStyles}
          side="bottom"
          sideOffset={6}
        >
          <BaseSelect.Popup className={popupStyles}>
            <BaseSelect.List className={listStyles}>
              {options.map((option, index) => (
                <BaseSelect.Item
                  className={itemStyles}
                  disabled={option.disabled}
                  key={index}
                  label={textLabelForOption(option)}
                  value={option.value}
                >
                  <BaseSelect.ItemText className={itemTextStyles}>
                    {option.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className={itemIndicatorStyles}>
                    <CheckIcon />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
};

// Forward clicks that landed on the wrapper (padding around the trigger,
// or the prefix icon area whose `pointer-events: none` lets clicks fall
// through) to the trigger button so any click within the container opens
// the dropdown. Clicks that already landed on the trigger (or one of its
// descendants — Value, caret) bubble up here too; the contains() guard
// stops us from double-firing in that case.
const openTriggerOnWrapperClick: MouseEventHandler<HTMLDivElement> = (
  event,
) => {
  if (!(event.target instanceof Node)) {
    return;
  }
  const trigger =
    event.currentTarget.querySelector<HTMLButtonElement>("[data-control]");
  if (trigger === null || trigger.contains(event.target)) {
    return;
  }
  trigger.click();
};

const triggerStyles = css({
  // Empty-value placeholder gets the muted color the wrapper would have
  // shown if it owned the text.
  "&[data-popup-open]": {
    // No special-case styling for now; the wrapper's `_focusVisible`
    // outline already conveys "open".
  },
  alignItems: "center",
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "pointer" },
  display: "flex",
  flexGrow: 1,
  fontFamily: "inherit",
  fontSize: "inherit",
  gap: "inherit",
  // Items are arranged with `Value` taking the available width and the
  // caret pinned at the inline end. `justify-content` would fight any
  // wrappers, so flex-grow on the value span (below) does the work.
  inlineSize: "100%",
  minInlineSize: 0,
  outlineStyle: "none",
  // `padding: 0` so the wrapper's per-size paddingInline owns the inset.
  padding: 0,
  textAlign: "start",
});

const caretStyles = css({
  "&[data-popup-open]": {
    transform: "rotate(180deg)",
  },
  color: "muted",
  flexShrink: 0,
  // Pin the caret to the inline-end regardless of the value text width.
  // The auto margin absorbs every pixel between the value and the caret,
  // so a one-character value and a hundred-character value both end at
  // the same right edge.
  marginInlineStart: "auto",
  transition: "transform {durations.fast} {easings.default}",
});

// The rounded variant inflates inline padding by 1.5 spacing units on top of
// the `control` recipe's per-size padding (xs: 1.5, sm: 2.5, md: 3, lg: 3.5,
// xl: 4, 2xl: 5.5, 3xl: 7.5, 4xl: 10 — see `CONTROL_PADDING_INLINE` in
// `control-sizes.ts`), matching Input's `rounded` overrides. Values inlined
// as literals (not derived from a helper) so Panda's static extractor can
// emit the corresponding atomic classes — helper return values are opaque.
//
// `cursor: pointer` overrides the `cursor: text` from `wrapperBase` — for
// Input/Textarea the wrapper hints "click here to start typing", but for
// Select the whole container is a click-to-open surface (see
// `openTriggerOnWrapperClick`).
const wrapperStyles = cva({
  base: {
    cursor: { _disabled: "not-allowed", base: "pointer" },
  },
  compoundVariants: [
    { css: { paddingInline: 3 }, rounded: true, size: "xs" },
    { css: { paddingInline: 4 }, rounded: true, size: "sm" },
    { css: { paddingInline: 4.5 }, rounded: true, size: "md" },
    { css: { paddingInline: 5 }, rounded: true, size: "lg" },
    { css: { paddingInline: 5.5 }, rounded: true, size: "xl" },
    { css: { paddingInline: 7 }, rounded: true, size: "2xl" },
    { css: { paddingInline: 9 }, rounded: true, size: "3xl" },
    { css: { paddingInline: 11.5 }, rounded: true, size: "4xl" },
  ],
  variants: {
    rounded: {
      true: { borderRadius: "full" },
    },
    size: {
      "2xl": {},
      "3xl": {},
      "4xl": {},
      lg: {},
      md: {},
      sm: {},
      xl: {},
      xs: {},
    },
  },
});

// Visible in both touch modes (sheet + centered overlay) — the dim
// behind any modal-style popup on touch devices. In mouse mode the
// backdrop stays transparent (base-ui still uses it for outside-click
// handling because Select runs in `modal` mode by default; we just
// don't paint anything).
const backdropStyles = css({
  _pointerCoarse: {
    "&[data-ending-style]": {
      opacity: 0,
      transition: "opacity {durations.fast} {easings.in}",
    },
    "&[data-starting-style]": { opacity: 0 },
    backgroundColor: "backdrop",
    opacity: 1,
    transition: "opacity {durations.normal} {easings.out}",
  },
  inset: 0,
  position: "fixed",
  zIndex: "modalBackdrop",
});

const positionerStyles = css({
  // Touch-overlay mode: centered modal-style popup. Override base-ui's
  // Floating-UI positioning so the positioner sits at the viewport
  // center via `top: 50% / left: 50%` plus a `-50%` translate. The
  // popup inside has its own transform for the open/close animation —
  // those compose without conflict because they're on different
  // elements.
  _touchOverlay: {
    bottom: "auto !important",
    left: "50% !important",
    position: "fixed !important",
    right: "auto !important",
    top: "50% !important",
    transform: "translate(-50%, -50%) !important",
  },
  // Touch-sheet mode: override base-ui's Floating-UI inline positioning
  // and pin the positioner to the bottom of the viewport. Side insets
  // give the drawer `{spacing.2}` (0.5rem) of breathing room on either
  // side against the backdrop; the bottom is flush with the viewport
  // edge (no gap) so the drawer reads as a bottom sheet pulled up. The
  // home indicator on iOS is cleared via inner `paddingBlockEnd` on
  // the popup. `!important` is necessary because Floating UI sets the
  // conflicting values via the `style` attribute — pure stylesheet
  // rules can't outrank it on specificity.
  _touchSheet: {
    bottom: "0 !important",
    left: "{spacing.2} !important",
    position: "fixed !important",
    right: "{spacing.2} !important",
    top: "auto !important",
    transform: "none !important",
  },
  outlineStyle: "none",
  zIndex: "modal",
});

const popupStyles = css({
  // Touch-overlay mode: centered modal-style popup. Same sizing /
  // padding as the touch sheet — large tap targets, generous max
  // height — but the popup floats in the viewport center with all
  // four corners rounded and a normal border on every side. Animates
  // with a fade + subtle scale (matches `ModalDialog`'s entry feel)
  // since slide-up makes no sense for a centered popup.
  _touchOverlay: {
    "&[data-ending-style]": {
      opacity: 0,
      transform: "scale(0.96)",
      transition:
        "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
    },
    "&[data-starting-style]": {
      opacity: 0,
      transform: "scale(0.96)",
    },
    borderRadius: "xl",
    inlineSize: "auto",
    maxBlockSize: "min(70vh, {spacing.160})",
    maxInlineSize: "min({spacing.120}, 90vw)",
    minInlineSize: "{spacing.80}",
    // Symmetric block padding — the centered overlay has all four
    // corners rounded, so the first and last items both need the same
    // breathing room from their rounded edge.
    paddingBlockEnd: 3,
    paddingBlockStart: 3,
    transform: "scale(1)",
    transition:
      "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.out}",
  },
  // Touch-sheet mode: bottom drawer that's flush with the viewport's
  // bottom edge but inset on the sides. The bottom-corner radius is 0
  // so the drawer meets the bottom cleanly; only the top corners are
  // rounded. Extra top padding gives the first list item breathing
  // room from the rounded top edge; the bottom padding maxes the
  // standard list gap with `env(safe-area-inset-bottom)` so iOS
  // devices with a home indicator don't overlap the last item.
  //
  // We drive the enter animation through `&[data-starting-style]` (set
  // and cleared by base-ui via JS) rather than Panda's `_starting`
  // (which maps to the CSS `@starting-style` at-rule). base-ui's
  // attribute fires reliably for newly-mounted portaled elements; the
  // browser's `@starting-style` doesn't always fire for a popup that
  // mounts inside a portal, which leaves the popup snapped to its
  // resting position with no animation.
  _touchSheet: {
    "&[data-ending-style]": {
      opacity: 1,
      transform: "translateY(100%)",
      transition: "transform {durations.normal} {easings.in}",
    },
    "&[data-starting-style]": {
      opacity: 1,
      transform: "translateY(100%)",
    },
    borderBlockEndWidth: 0,
    borderEndEndRadius: 0,
    borderEndStartRadius: 0,
    borderStartEndRadius: "xl",
    borderStartStartRadius: "xl",
    inlineSize: "auto",
    maxBlockSize: "70vh",
    minInlineSize: "auto",
    paddingBlockEnd: "max({spacing.1.5}, env(safe-area-inset-bottom))",
    paddingBlockStart: 3,
    transition:
      "transform {durations.normal} {easings.out}, opacity {durations.normal} {easings.out}",
  },
  "&[data-ending-style]": {
    opacity: 0,
    transform: "scaleY(0.8)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  // Non-touch enter animation: fade in + slide down from above + small
  // scale-up, with `transform-origin: top` so the scale grows from the
  // top edge (the side closest to the trigger). We drive this through
  // `&[data-starting-style]` (set and cleared by base-ui via JS) rather
  // than Panda's `_starting` (which maps to the CSS `@starting-style`
  // at-rule) because `@starting-style` doesn't reliably fire for
  // portaled popups — the popup would snap into place with no
  // transition. The touch modes below use the same attribute approach
  // for the same reason. Touch-mode overrides (`_touchOverlay`,
  // `_touchSheet`) below replace this with mode-appropriate motion
  // (scale for centered, slide-from-bottom for sheet).
  "&[data-starting-style]": {
    opacity: 0,
    transform: "scaleY(0.8)",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  // The popup is a flex column with `overflow: hidden`; the inner List
  // is the actual scroll container (see `listStyles`). That keeps the
  // scrolling content clipped inside the popup's padding box, so items
  // never visibly slide behind the rounded border on scroll.
  display: "flex",
  flexDirection: "column",
  // Force the popup to render at the trigger's exact width so the
  // "popup as continuation of the field" effect of `alignItemWithTrigger`
  // is honored even when the longest option's natural width would be
  // narrower than the trigger. `--anchor-width` is the trigger's measured
  // pixel width, set by base-ui's anchor positioner via Floating UI's
  // `size()` middleware. Long labels truncate via `text-overflow: ellipsis`
  // on the item text rather than widening the popup.
  inlineSize: "var(--anchor-width)",
  // Cap the visible window; the List inside handles scroll.
  maxBlockSize: "min(60vh, {spacing.96})",
  opacity: 1,
  outlineStyle: "none",
  overflow: "hidden",
  paddingBlock: 1,
  transform: "translateY(0) scale(1)",
  // Anchor the scale transform to the top edge so the popup appears to
  // grow downward out of the trigger, rather than puffing out from its
  // own center.
  transformOrigin: "top",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.out}",
});

// The actual scroll container: takes the remaining height of the popup's
// flex column and scrolls its contents. `minBlockSize: 0` is required to
// let a flex child shrink below its content size so `overflow-y: auto`
// can engage — without it, the List would simply expand the popup and
// no scroll would appear.
const listStyles = css({
  flexGrow: 1,
  minBlockSize: 0,
  overflowY: "auto",
});

const itemStyles = css({
  // Touch devices (both sheet and centered-overlay modes): bump
  // font-size and tap-target padding so items are comfortable to hit
  // with a finger (Apple HIG recommends 44px minimum, Material 48dp —
  // these paddings clear both).
  _pointerCoarse: {
    fontSize: "md",
    paddingBlock: 3.5,
    paddingInline: 4,
  },
  "&[data-disabled]": {
    color: "muted",
    opacity: "disabled",
  },
  // `data-highlighted` is set by base-ui on the keyboard-focused item;
  // hover separately tints via Panda's `_hover` so mouse and keyboard
  // navigation feel the same.
  "&[data-highlighted], &:hover:not([data-disabled])": {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, transparent)",
  },
  alignItems: "center",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "pointer" },
  display: "grid",
  fontSize: "sm",
  gap: 2,
  // 1fr for the label, auto for the trailing check indicator.
  gridTemplateColumns: "1fr auto",
  outlineStyle: "none",
  paddingBlock: 1.5,
  paddingInline: 3,
});

const itemTextStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const itemIndicatorStyles = css({
  alignItems: "center",
  color: "accent",
  display: "inline-flex",
  flexShrink: 0,
});
