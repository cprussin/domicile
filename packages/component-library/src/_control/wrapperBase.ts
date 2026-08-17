import { css } from "../../styled-system/css";

/**
 * Base styles shared by the Input, Textarea, and Select wrapper divs. The
 * `:has()` selectors below let the wrapper restyle itself based on the
 * *control* inside it (the `<input>` / `<textarea>` / Select trigger
 * marked with `data-control=""`) without the React tree having to mirror
 * that state.
 *
 * Every state selector is scoped to `[data-control]` (never bare
 * `:has(:disabled)` / `:has(:focus-visible)` / etc.) so that buttons or
 * other interactive descendants — most notably the trailing-group's
 * `suffixButtons` — don't bleed their own state into the wrapper. A
 * disabled Send button must not grey out the textarea.
 *
 * The control coordinates with three companion data-attributes that
 * `PrefixIconStack` sets:
 *   - `data-prefix-stack`     — outer span when an icon prefix is provided;
 *                               its children animate to swap the icon for an
 *                               invalid indicator when the control is invalid
 *   - `data-prefix-decoration`— the icon child (animates *down* and out)
 *   - `data-prefix-invalid`   — the invalid indicator child (animates *in*)
 *   - `data-prefix-standalone`— outer span when there is no icon prefix;
 *                               slides an invalid indicator in horizontally
 *
 * State matrix the selectors below cover (axes ordered by specificity):
 *
 *   disabled  → backgroundColor:card, opacity:disabled, cursor:not-allowed
 *   invalid   → borderColor:dangerSoft, prefix-icon swap animation
 *   focused   → outlineColor:accent (or danger if also invalid),
 *               borderColor:accent (skipped when invalid — the
 *               danger border + danger outline already carry that
 *               signal), color:foreground. The "focused" axis matches three
 *               signals on the control, any of which keeps the wrapper
 *               looking focused:
 *                 - `:focus`             — the control owns DOM focus.
 *                                          Matches `:focus` (not
 *                                          `:focus-visible`) so a mouse
 *                                          click into the control
 *                                          immediately lights the
 *                                          accent outline.
 *                 - `[data-popup-open]`  — base-ui sets this on the
 *                                          Select trigger while its
 *                                          popup is open. Focus is
 *                                          inside the portaled popup,
 *                                          so `:focus` is gone but the
 *                                          attribute keeps the wrapper
 *                                          looking focused.
 *                 - `[data-active]`      — set by Select (and only
 *                                          Select) for the *entire*
 *                                          open lifecycle: opened on
 *                                          `onOpenChange(true)`,
 *                                          cleared on
 *                                          `onOpenChangeComplete(false)`
 *                                          after the close animation
 *                                          and refocus complete. Bridges
 *                                          the otherwise-visible gap
 *                                          between `[data-popup-open]`
 *                                          being removed and `:focus`
 *                                          landing on the trigger, so
 *                                          there is no transient
 *                                          unfocused frame to fade.
 *   hovered   → borderColor:muted (or danger if also invalid)
 *
 * The "hovered" axis also matches when the inner control carries
 * `data-resizing` (set by `ResizeHandle` during a drag) so the wrapper
 * keeps its hover border for the duration of the drag even after the
 * pointer leaves the wrapper. The resize handle itself is also styled to
 * its hover color via a descendant rule on `[data-resize-handle]`.
 *
 * Each more-specific axis takes precedence; the `:not(...)` chains ensure
 * the less-specific rules don't apply when a more-specific one would.
 *
 * This is published as a `css(...)` className (not a plain style object)
 * so Panda's static extractor sees every literal selector and property at
 * the call site here. Consuming the const as `cva({ base: wrapperBase })`
 * in Input/Textarea was opaque to the extractor — the cross-file const
 * reference produced classes with no CSS rules in the bundle, which is
 * why hover and focus styles silently stopped applying.
 */
export const wrapperBase = css({
  "&:has([data-control]:disabled)": {
    backgroundColor: "card",
    borderColor: "borderStrong",
    color: "muted",
    cursor: "not-allowed",
    opacity: "disabled",
  },
  "&:has([data-control]:is(:focus, [data-popup-open], [data-active]))": {
    color: "foreground",
  },
  "&:has([data-control]:is(:focus, [data-popup-open], [data-active])):not(:has([data-control][data-invalid]))":
    {
      borderColor: "accent",
      outlineColor: "accent",
    },
  "&:has([data-control][data-invalid]:is(:focus, [data-popup-open], [data-active]))":
    {
      outlineColor: "danger",
    },
  "&:has([data-control][data-invalid]) [data-prefix-stack] [data-prefix-decoration]":
    {
      transform: "translateY(100%)",
    },
  "&:has([data-control][data-invalid]) [data-prefix-stack] [data-prefix-invalid]":
    {
      transform: "translateY(0)",
    },
  "&:has([data-control][data-invalid]) [data-prefix-standalone]": {
    gridTemplateColumns: "1fr",
    marginInlineEnd: 0,
  },
  "&:has([data-control][data-invalid]) [data-prefix-standalone] > *": {
    transform: "translateX(0)",
  },
  "&:has([data-control][data-invalid]):is(:hover, :has([data-control][data-resizing])):not(:has([data-control]:disabled)):not(:has([data-control]:is(:focus, [data-popup-open], [data-active])))":
    {
      borderColor: "danger",
    },
  "&:has([data-control][data-invalid]):not(:has([data-control]:disabled))": {
    borderColor: "dangerSoft",
  },
  "&:has([data-control][data-resizing]) [data-resize-handle]": {
    color: "muted",
  },
  "&:is(:hover, :has([data-control][data-resizing])):not(:has([data-control]:disabled)):not(:has([data-control]:is(:focus, [data-popup-open], [data-active]))):not(:has([data-control][data-invalid]))":
    {
      borderColor: "muted",
    },
  // Label-hover hover state (next two rules). When the user hovers the
  // Field's `<label>`, mirror the wrapper's hover affordance (so the
  // connection between label and control is visible — clicking the label
  // will act on the control). The `:where(...)` keeps the subject of the
  // rule as the wrapper class (Panda requires selector keys to start with
  // `&`) while asserting the wrapper sits at
  // `[data-domicile-field]:has(> label:hover) > div > *`. Anchoring on
  // Field's `data-domicile-field` root scopes the rule to domicile Fields — it
  // won't leak to arbitrary `<label>`s on the page that happen to precede
  // a control. The `:not(...)` chain matches the wrapper's own `:hover`
  // rule so disabled/focused/invalid take precedence identically.
  "&:where([data-domicile-field]:has(> label:hover) > div > *):has([data-control][data-invalid]):not(:has([data-control]:disabled)):not(:has([data-control]:is(:focus, [data-popup-open], [data-active])))":
    {
      borderColor: "danger",
    },
  "&:where([data-domicile-field]:has(> label:hover) > div > *):not(:has([data-control]:disabled)):not(:has([data-control]:is(:focus, [data-popup-open], [data-active]))):not(:has([data-control][data-invalid]))":
    {
      borderColor: "muted",
    },
  backgroundColor: "background",
  border: "1px solid {colors.border}",
  color: "muted",
  // Base cursor lives on each consumer's own wrapper styles (Input/Textarea
  // pick `text`, Select picks `pointer`). Putting it here would emit a
  // single atomic class for whichever value was extracted last, and that
  // class would win the property race for every consumer regardless of
  // what they set in their own cva. The disabled override above is fine —
  // its `:has(...)` selector boosts specificity above any consumer's base
  // cursor class, so `cursor: not-allowed` wins for disabled controls in
  // every wrapper.
  inlineSize: "100%",
  outlineOffset: 0,
  outlineWidth: 1,
});
