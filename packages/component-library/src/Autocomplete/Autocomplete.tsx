import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import type { ReactNode } from "react";
import { css, cva, cx } from "../../styled-system/css";
import type { ControlVariant } from "../../styled-system/recipes";
import { control } from "../../styled-system/recipes";
import { controlSizingStyle } from "../_control/controlSizingStyle";
import { focusControlOnMouseDown } from "../_control/focus";
import { PrefixIconStack } from "../_control/PrefixIconStack";
import { wrapperBase } from "../_control/wrapperBase";
import type { ExtendProps } from "../extend-props";

export { SIZES, type Size } from "../control-sizes";

/** One line of the list under the field. */
export type Suggestion<V> = {
  /** What the caller gets back when this one is taken. */
  value: V;
  /** What the field fills with when this one is highlighted or taken. */
  text: string;
  /** The line itself. */
  label: ReactNode;
  /** A second, quieter line under it — where the suggestion came from, what it will do. */
  description?: ReactNode | undefined;
  /** Drawn at the inline start of the line. */
  icon?: ReactNode | undefined;
};

type CommonProps<V> = Partial<ControlVariant> & {
  /**
   * Whether the first suggestion highlights as soon as the user types, so
   * Enter takes it and the field fills with it ahead of the caret.
   *
   * What an address bar wants: the line it is already halfway to is the first
   * one, so Enter means "the obvious thing" without an arrow key first. A
   * field whose first line is not the obvious thing wants this off, or Enter
   * takes something the user never looked at.
   */
  autoHighlight?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Shown in place of the list when `suggestions` is empty. */
  emptyMessage?: ReactNode | undefined;
  onSuggestionTaken?: ((value: V) => void) | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  rounded?: boolean | undefined;
  /**
   * The lines to offer, already chosen and already in order.
   *
   * THE CALLER DOES THE MATCHING. A field that filtered what it was given
   * could only match on the text it can see, and the interesting lists are the
   * ones where it cannot: an address bar ranks a host the user visits daily
   * over one they saw once, and offers a search for what was typed that
   * matches nothing at all.
   */
  suggestions: readonly Suggestion<V>[];
  /** Controls rendered at the inline end of the field, inside its border. */
  suffixButtons?: ReactNode | undefined;
  value?: string | undefined;
  width?: number | undefined;
};

type Props<V> = ExtendProps<
  typeof BaseAutocomplete.Input,
  CommonProps<V> &
    // A prefix is either decoration or a control, and never both: the icon
    // slot takes no pointer — it is what the invalid indicator animates in
    // and out of — so a button put there could not be pressed. A browser's
    // site indicator is a control, which is what `prefixButtons` is for.
    (
      | { prefixButtons?: undefined; prefixIcon?: ReactNode | undefined }
      | { prefixButtons: ReactNode; prefixIcon?: undefined }
    )
>;

/**
 * A text field with a list of suggestions under it, wrapping the
 * `@base-ui/react` Autocomplete primitive.
 *
 * Same surface as `Input`: the `control` recipe and the `wrapperBase` state
 * matrix, so its border, focus ring, hover and invalid styling are the other
 * form controls' verbatim. What it adds is the list — arrow keys move through
 * it, the highlighted line fills the field ahead of the caret, and Enter takes
 * it.
 *
 * Highlighting fills the field rather than only marking a line, which is the
 * behaviour of every address bar: what the user would get by pressing Enter is
 * readable without looking away from where they are typing.
 */
export const Autocomplete = <V,>({
  autoHighlight = false,
  disabled,
  emptyMessage,
  onSuggestionTaken,
  onValueChange,
  prefixButtons,
  prefixIcon,
  rounded = false,
  size = "md",
  suggestions,
  suffixButtons,
  value,
  width,
  ...inputProps
}: Props<V>) => (
  <BaseAutocomplete.Root<Suggestion<V>>
    autoHighlight={autoHighlight}
    disabled={disabled}
    items={suggestions}
    itemToStringValue={(suggestion) => suggestion.text}
    // `inline` rather than `list` or `both`: the caller has already chosen
    // which lines to offer — see `suggestions` — so a second round of matching
    // inside the field would only throw away the ones it could not see a
    // reason for.
    mode="inline"
    onValueChange={(next) => {
      onValueChange?.(next);
    }}
    value={value}
  >
    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: focuses the field when the wrapper's padding is clicked; mirrors native <label> behavior without a second label polluting the accessible name */}
    {/* biome-ignore lint/a11y/noStaticElementInteractions: focuses the field when the wrapper's padding is clicked; mirrors native <label> behavior without a second label polluting the accessible name */}
    <div
      className={cx(
        control({ size }),
        wrapperBase,
        wrapperStyles({ rounded, size }),
      )}
      onMouseDown={focusControlOnMouseDown}
      style={controlSizingStyle({ width })}
    >
      {prefixButtons === undefined ? (
        <PrefixIconStack prefixIcon={prefixIcon} size={size} />
      ) : (
        <span className={affixStyles}>{prefixButtons}</span>
      )}
      <BaseAutocomplete.Input
        {...inputProps}
        className={inputStyles}
        data-control=""
      />
      {suffixButtons !== undefined && (
        <span className={affixStyles}>{suffixButtons}</span>
      )}
    </div>
    <BaseAutocomplete.Portal>
      <BaseAutocomplete.Positioner
        align="start"
        className={positionerStyles}
        side="bottom"
        sideOffset={6}
      >
        <BaseAutocomplete.Popup className={popupStyles}>
          <BaseAutocomplete.Empty className={emptyStyles}>
            {emptyMessage}
          </BaseAutocomplete.Empty>
          <BaseAutocomplete.List className={listStyles}>
            {suggestions.map((suggestion, index) => (
              <BaseAutocomplete.Item
                className={itemStyles}
                index={index}
                key={index}
                onClick={() => {
                  onSuggestionTaken?.(suggestion.value);
                }}
                value={suggestion}
              >
                {suggestion.icon !== undefined && (
                  <span className={itemIconStyles}>{suggestion.icon}</span>
                )}
                <span className={itemLabelStyles}>{suggestion.label}</span>
                {suggestion.description !== undefined && (
                  <span className={itemDescriptionStyles}>
                    {suggestion.description}
                  </span>
                )}
              </BaseAutocomplete.Item>
            ))}
          </BaseAutocomplete.List>
        </BaseAutocomplete.Popup>
      </BaseAutocomplete.Positioner>
    </BaseAutocomplete.Portal>
  </BaseAutocomplete.Root>
);

const inputStyles = css({
  "&::placeholder": { color: "muted" },
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "text" },
  flexGrow: 1,
  inlineSize: "100%",
  minInlineSize: 0,
  outlineStyle: "none",
  padding: 0,
  textOverflow: "ellipsis",
});

// Both ends of the field, which want the same thing: a row of controls that
// keeps its size while the text beside it grows, and that inherits the
// control recipe's per-size gap so it is spaced like the rest of the field.
const affixStyles = css({
  alignItems: "center",
  display: "inline-flex",
  flexShrink: 0,
  gap: "inherit",
});

// The rounded variant inflates inline padding by 1.5 spacing units on top of
// the `control` recipe's per-size padding (xs: 1.5, sm: 2.5, md: 3, lg: 3.5,
// xl: 4 — see `CONTROL_PADDING_INLINE` in `control-sizes.ts`), matching
// Input's `rounded` overrides. Values inlined as literals (not derived from a
// helper) so Panda's static extractor can emit the corresponding atomic
// classes — helper return values are opaque to it.
const wrapperStyles = cva({
  base: {
    // Owned here rather than in `wrapperBase` for the reason Input owns it —
    // see the note at the top of `wrapperBase.ts`.
    cursor: "text",
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

const positionerStyles = css({
  outlineStyle: "none",
  zIndex: "modal",
});

const popupStyles = css({
  "&[data-ending-style]": {
    opacity: 0,
    transform: "scaleY(0.9)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  // base-ui's own attribute rather than Panda's `_starting`: the browser's
  // `@starting-style` does not reliably fire for an element that mounts inside
  // a portal, which leaves the list snapped into place with no animation.
  "&[data-starting-style]": {
    opacity: 0,
    transform: "scaleY(0.9)",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  display: "flex",
  flexDirection: "column",
  // The field's own width, so the list reads as a continuation of it rather
  // than a panel that happens to be underneath. `--anchor-width` is measured
  // by base-ui's positioner.
  inlineSize: "var(--anchor-width)",
  maxBlockSize: "min(60vh, {spacing.96})",
  opacity: 1,
  outlineStyle: "none",
  overflow: "hidden",
  paddingBlock: 1,
  transform: "scaleY(1)",
  transformOrigin: "top",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.out}",
});

// Stays mounted whether or not the list is empty — base-ui announces the
// change through it, and a node that is conditionally rendered announces
// nothing. `:empty` is what hides it when there is nothing to say.
const emptyStyles = css({
  "&:empty": { display: "none" },
  color: "muted",
  fontSize: "sm",
  paddingBlock: 2,
  paddingInline: 3,
});

const listStyles = css({
  flexGrow: 1,
  minBlockSize: 0,
  overflowY: "auto",
});

const itemStyles = css({
  "&[data-highlighted]": {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, transparent)",
  },
  alignItems: "center",
  color: "foreground",
  columnGap: 2,
  cursor: "pointer",
  display: "grid",
  fontSize: "sm",
  // The icon takes what it needs, the label takes the rest, and the
  // description is pinned at the inline end — which is the shape of every
  // address bar's list: what you are going to, and why it is being offered.
  gridTemplateColumns: "auto 1fr auto",
  outlineStyle: "none",
  paddingBlock: 1.5,
  paddingInline: 3,
});

const itemIconStyles = css({
  alignItems: "center",
  color: "muted",
  display: "inline-flex",
});

const itemLabelStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const itemDescriptionStyles = css({
  color: "muted",
  fontSize: "xs",
  whiteSpace: "nowrap",
});
