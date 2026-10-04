import { css } from "../../styled-system/css";

/**
 * Base styles for the Input, Textarea and Select wrappers.
 *
 * `:has()` selectors style the wrapper from the state of the control inside
 * it, marked `data-control`. Selectors always target `[data-control]` so
 * suffix buttons can't affect the wrapper; a disabled Send button must not
 * gray out the textarea. Precedence is disabled, invalid, focused, hovered,
 * enforced by the `:not(...)` chains.
 *
 * The wrapper looks focused when the control has `:focus`,
 * `[data-popup-open]` (a Select popup holds focus), or `[data-active]`
 * (Select sets it until the close animation and refocus finish, so there is
 * no unfocused frame). It matches `:focus`, not `:focus-visible`, so a mouse
 * click also shows the outline. `[data-resizing]` from `ResizeHandle` keeps
 * the hover border during a drag.
 *
 * This is a `css()` class, not a style object, because Panda only extracts
 * styles written at the call site. A shared object passed into `cva` would
 * produce classes with no rules.
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
  // The next two rules show the hover border while the Field's `<label>` is
  // hovered. `:where(...)` keeps the selector starting with `&`, as Panda
  // requires, and `[data-domicile-field]` limits it to our Fields.
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
  // No base `cursor`: each wrapper sets its own, and a shared atomic class
  // here would override them. The disabled `:has()` rule is more specific,
  // so it still wins.
  inlineSize: "100%",
  outlineOffset: 0,
  outlineWidth: 1,
});
