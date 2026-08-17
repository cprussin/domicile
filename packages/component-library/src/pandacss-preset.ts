import type { Preset } from "@pandacss/dev";
import { definePreset, defineRecipe } from "@pandacss/dev";
import pandacssPreset from "@pandacss/dev/presets";
import type { Size } from "./control-sizes";
import { CONTROL_HEIGHT, CONTROL_PADDING_INLINE } from "./control-sizes";
import { SPACING_STEP_REM } from "./spacing";

// The pandacss preset and `@pandacss/dev`'s Preset shape are slightly
// different. The values are compatible at runtime. Bind to a typed local with a
// ts-expect-error so the suppression fails loudly — and can be deleted along
// with this comment — the moment the two packages' types converge.
// @ts-expect-error preset shape mismatch between @pandacss/preset-panda and @pandacss/dev
const basePreset: Preset = pandacssPreset;

// Extends the default Panda spacing scale with every quarter-step from `0`
// through `MAX_SPACING_STEP`, each resolving to `step * SPACING_STEP_REM`
// rem. The upper bound is large because compound-variants and inline
// `width`/`height` numeric props all read from this scale; capping low
// would silently break dynamically-sized containers. The set is sparse at
// the consumer (only referenced steps emit CSS) but listed densely here so
// any lookup succeeds.
const MAX_SPACING_STEP = 1000;
// Distance between adjacent keys: 0, 0.25, 0.5, … (the rem value of one step,
// `SPACING_STEP_REM`, is shared with the runtime helpers in `./spacing`).
const SPACING_STEP_KEY_INCREMENT = 0.25;
const quarterStepSpacing = Object.fromEntries(
  Array.from(
    { length: MAX_SPACING_STEP / SPACING_STEP_KEY_INCREMENT + 1 },
    (_, i) => {
      const step = i * SPACING_STEP_KEY_INCREMENT;
      return [step.toString(), { value: `${step * SPACING_STEP_REM}rem` }];
    },
  ),
);

export const domicilePreset = definePreset({
  conditions: {
    extend: {
      activeEnabled: "&:active:not(:disabled):not([data-disabled])",
      hoverEnabled: "&:hover:not(:disabled):not([data-disabled])",
      // Panda's built-in `_light` condition keys off a `light` *class*; the
      // chrome flips themes with `data-theme="light"` on `<html>` instead, so
      // the attribute and the theme it names stay together in the markup.
      light: "[data-theme=light] &",
      // Touch-input device. The `pointer` media feature is the only
      // correct signal for "primary input is a finger" — viewport width
      // alone misclassifies a docked laptop in tablet mode (still
      // mouse) and a touchscreen monitor (still mouse). Anything driven
      // by a coarse pointer wants larger tap targets and a visible
      // backdrop scrim around overlays.
      pointerCoarse: "@media (pointer: coarse)",
      // Touch device on a tablet-sized or larger screen — centered
      // modal-style overlay. Same large tap targets and visible
      // backdrop as `touchSheet`, but the popup floats in the middle
      // of the viewport with all four corners rounded instead of
      // riding the bottom edge.
      touchOverlay: "@media (pointer: coarse) and (min-width: 640px)",
      // Touch device on a small (phone-sized) screen — mobile sheet
      // pattern: bottom drawer pulled up from the viewport edge. 640px
      // matches Panda's `sm` breakpoint and aligns the boundary with
      // `touchOverlay` below so devices land in exactly one mode.
      touchSheet: "@media (pointer: coarse) and (max-width: 639px)",
    },
  },
  // biome-ignore assist/source/useSortedKeys: Theme-toggle-wipe rules are kept grouped under their shared explanatory comment instead of being scattered alphabetically.
  globalCss: {
    // Theme-toggle wipe. Consumers that trigger a theme flip via
    // `document.startViewTransition(...)` get the new theme wiped over
    // the old one as a clip-path swipe across the viewport — smoother
    // than animating every color property individually (which would
    // force a global `transition` declaration that overrides element-
    // specific transitions). Direction is selected by the
    // `data-theme-flip-to` attribute set on `<html>` before the
    // transition starts: going *to* dark wipes in from the top,
    // going *to* light wipes in from the bottom. The browser skips view
    // transitions automatically under `prefers-reduced-motion`.
    "::view-transition-old(root)": {
      // The old snapshot stays fully opaque underneath; only the new
      // layer animates. Without this the browser's default fade-out
      // plays alongside the wipe and we get a half-fade plus a swipe.
      animationName: "none",
    },
    "::view-transition-new(root)": {
      animationDuration: "{durations.slowest}",
      animationTimingFunction: "{easings.outQuart}",
      // Force opaque composition so the wipe is a clean reveal instead
      // of the default `plus-lighter` blend, which would leave an
      // additive seam at the leading edge of the clip.
      mixBlendMode: "normal",
    },
    "html[data-theme-flip-to='dark']::view-transition-new(root)": {
      animationName: "themeSwipeFromTop",
    },
    "html[data-theme-flip-to='light']::view-transition-new(root)": {
      animationName: "themeSwipeFromBottom",
    },
    // Suppress every element-level transition while a theme flip is in
    // flight. Without this, transitions like the control recipe's
    // `background-color {durations.fastest}` are still mid-flight when
    // the browser captures the "new" snapshot — the snapshot ends up
    // looking nearly identical to the old one, so the crossfade has
    // nothing to fade *between* for those elements, and once the
    // transition reveals the real DOM at the end, the in-flight
    // per-element transitions snap to completion visibly. The
    // `data-theme-flipping` attribute is set on `<html>` immediately
    // before `startViewTransition` and cleared in its `finished`
    // handler. `!important` is necessary to override per-element
    // `transition` declarations that have higher specificity than
    // `[data-theme-flipping] *`.
    "[data-theme-flipping] *, [data-theme-flipping] *::before, [data-theme-flipping] *::after":
      {
        transition: "none !important",
      },
    html: {
      "::selection": {
        backgroundColor: "accent",
        color: "background",
      },
      "*": {
        "&::-webkit-scrollbar": {
          blockSize: 2,
          inlineSize: 2,
        },
        "&::-webkit-scrollbar-corner": {
          backgroundColor: "transparent",
        },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "border",
          borderRadius: "full",
          transition: "background-color {durations.fast} {easings.out}",
        },
        "&::-webkit-scrollbar-thumb:active": {
          backgroundColor: "foreground",
        },
        "&::-webkit-scrollbar-thumb:hover": {
          backgroundColor: "muted",
        },
        "&::-webkit-scrollbar-track": {
          backgroundColor: "transparent",
        },
        outlineColor: {
          _focusVisible: "accent",
          base: "transparent",
        },
        outlineOffset: 0.5,
        outlineStyle: "solid",
        outlineWidth: 2,
        scrollbarColor: "{colors.border} transparent",
        scrollbarWidth: "thin",
      },
      backgroundColor: "background",
      color: "foreground",
    },
  },
  name: "domicile",
  presets: [basePreset],
  theme: {
    extend: {
      keyframes: {
        pulse: {
          "0%": { opacity: "0.3" },
          "50%": { opacity: "0.7" },
          "100%": { opacity: "0.3" },
        },
        themeSwipeFromBottom: {
          "0%": { clipPath: "inset(100% 0 0 0)" },
          "100%": { clipPath: "inset(0 0 0 0)" },
        },
        themeSwipeFromTop: {
          "0%": { clipPath: "inset(0 0 100% 0)" },
          "100%": { clipPath: "inset(0 0 0 0)" },
        },
      },
      recipes: {
        control: defineRecipe({
          base: {
            alignItems: "center",
            display: "inline-flex",
            flexDirection: "row",
            justifyContent: "center",
            transition: `
              color {durations.fastest} {easings.linear},
              border-color {durations.fastest} {easings.linear},
              box-shadow {durations.fastest} {easings.linear},
              background-color {durations.fastest} {easings.linear},
              outline-color {durations.fast} {easings.linear},
              opacity {durations.slow} {easings.out},
              filter {durations.slow} {easings.out}
            `,
          },
          className: "control",
          // Bind to the JSX components that consume the recipe so Panda
          // extracts `size` from `<Button size="sm">` at consumer call sites.
          // Without this, only sizes that appear as object literals (e.g.
          // `control({ size: "md" })`, recipe compoundVariants) get emitted —
          // runtime calls like `control({ size })` inside the wrapper are
          // opaque to the static extractor.
          jsx: ["Button", "Input", "Select", "Textarea"],
          variants: {
            // biome-ignore assist/source/useSortedKeys: The sort order is useful here
            size: {
              xs: {
                blockSize: CONTROL_HEIGHT.xs,
                borderRadius: "sm",
                fontSize: "xs",
                gap: 1,
                minBlockSize: CONTROL_HEIGHT.xs,
                paddingInline: CONTROL_PADDING_INLINE.xs,
              },
              sm: {
                blockSize: CONTROL_HEIGHT.sm,
                borderRadius: "sm",
                fontSize: "sm",
                gap: 1.5,
                minBlockSize: CONTROL_HEIGHT.sm,
                paddingInline: CONTROL_PADDING_INLINE.sm,
              },
              md: {
                blockSize: CONTROL_HEIGHT.md,
                borderRadius: "md",
                fontSize: "md",
                gap: 2,
                minBlockSize: CONTROL_HEIGHT.md,
                paddingInline: CONTROL_PADDING_INLINE.md,
              },
              lg: {
                blockSize: CONTROL_HEIGHT.lg,
                borderRadius: "lg",
                fontSize: "lg",
                gap: 2.5,
                minBlockSize: CONTROL_HEIGHT.lg,
                paddingInline: CONTROL_PADDING_INLINE.lg,
              },
              xl: {
                blockSize: CONTROL_HEIGHT.xl,
                borderRadius: "lg",
                fontSize: "xl",
                gap: 3,
                minBlockSize: CONTROL_HEIGHT.xl,
                paddingInline: CONTROL_PADDING_INLINE.xl,
              },
              "2xl": {
                blockSize: CONTROL_HEIGHT["2xl"],
                borderRadius: "xl",
                fontSize: "2xl",
                gap: 4,
                minBlockSize: CONTROL_HEIGHT["2xl"],
                paddingInline: CONTROL_PADDING_INLINE["2xl"],
              },
              "3xl": {
                blockSize: CONTROL_HEIGHT["3xl"],
                borderRadius: "2xl",
                fontSize: "3xl",
                gap: 5.5,
                minBlockSize: CONTROL_HEIGHT["3xl"],
                paddingInline: CONTROL_PADDING_INLINE["3xl"],
              },
              "4xl": {
                blockSize: CONTROL_HEIGHT["4xl"],
                borderRadius: "3xl",
                fontSize: "4xl",
                gap: 7.5,
                minBlockSize: CONTROL_HEIGHT["4xl"],
                paddingInline: CONTROL_PADDING_INLINE["4xl"],
              },
            } satisfies Record<Size, unknown>,
          },
        }),
      },
      semanticTokens: {
        // Light/dark theming: `base` is the dark palette (matches the
        // app's original look). Setting `data-theme="light"` on `<html>`
        // (or any ancestor) flips to the `_light` overrides via Panda's
        // built-in `_light` condition.
        //
        // Only the *primitive* color tokens (foreground, background,
        // accent, danger, success, warning) need per-theme values. The
        // derived tokens below resolve at CSS time via `color-mix(...,
        // var(--colors-foreground), var(--colors-background))` — when
        // the CSS variables for foreground/background flip, every
        // derived token recomputes automatically.
        colors: {
          accent: {
            value: { _light: "{colors.cyan.600}", base: "{colors.cyan.500}" },
          },
          backdrop: {
            // Black scrim works for both modes: in dark mode it creates
            // depth; in light mode it dims the page enough to focus on
            // the modal without losing readability.
            value: "rgb(from black r g b / 70%)",
          },
          background: {
            value: {
              _light: "{colors.neutral.50}",
              base: "{colors.neutral.900}",
            },
          },
          border: {
            value:
              "color-mix(in oklab, {colors.foreground} 18%, {colors.background})",
          },
          borderStrong: {
            value:
              "color-mix(in oklab, {colors.foreground} 25%, {colors.background})",
          },
          card: {
            value:
              "color-mix(in oklab, {colors.foreground} 6%, {colors.background})",
          },
          danger: {
            value: { _light: "{colors.red.600}", base: "{colors.red.500}" },
          },
          dangerSoft: {
            value:
              "color-mix(in oklab, {colors.danger} 70%, {colors.background})",
          },
          foreground: {
            value: {
              _light: "{colors.neutral.900}",
              base: "{colors.neutral.200}",
            },
          },
          muted: {
            value:
              "color-mix(in oklab, {colors.foreground} 55%, {colors.background})",
          },
          skeleton: {
            value:
              "color-mix(in oklab, {colors.foreground} 25%, {colors.background})",
          },
          success: {
            value: { _light: "{colors.green.700}", base: "{colors.green.500}" },
          },
          warning: {
            value: { _light: "{colors.amber.700}", base: "{colors.amber.500}" },
          },
        },
        shadows: {
          // Soft, broad drop shadow for floating surfaces that sit on top of
          // the chat content (e.g. the message Composer). Bigger and softer
          // than the default `shadows.md` so the elevation reads on the
          // dark `background` without looking crisply outlined. Light mode
          // drops the alpha dramatically (50% → 15%) because the same shadow
          // on a light surface looks heavy and grayed-out — light surfaces
          // need just enough contrast to imply lift, not a hard halo.
          lifted: {
            value: {
              _light: "0 6px 24px rgb(from black r g b / 15%)",
              base: "0 6px 24px rgb(from black r g b / 50%)",
            },
          },
          modal: {
            value: "0 20px 48px rgb(from black r g b / 60%)",
          },
        },
      },
      tokens: {
        durations: {
          pulse: { value: "1.5s" },
        },
        easings: {
          // Back-out with a ~15% overshoot at the end of the curve.
          // Used by the ThemeSwitch slot's rise transition to give the
          // landing icon a small bounce.
          outBack: { value: "cubic-bezier(0.34, 1.8, 0.64, 1)" },
          // Moderately strong ease-out (easeOutQuart). Decelerates
          // noticeably — fast at the start, easing to a soft landing —
          // but less abrupt than easeOutExpo. Use for "settling"
          // animations (e.g. the theme-toggle wipe) where the default
          // `easings.out` feels too linear.
          outQuart: { value: "cubic-bezier(0.25, 1, 0.5, 1)" },
        },
        fonts: {
          mono: {
            value:
              "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
          },
        },
        opacity: {
          disabled: { value: "0.6" },
          // A dragged element fades to signal it's the one in flight, so the
          // drop target reads clearly underneath it.
          dragging: { value: "0.4" },
          pulseMin: { value: "0.3" },
        },
        // `sizes` mirrors `spacing` so bare numbers on size props
        // (`inlineSize`, `blockSize`, `min*Size`, `max*Size`) resolve through
        // the same quarter-step scale. Without this, Panda treats numeric
        // size values as raw pixels (`inlineSize: 65` → `65px` instead of
        // `var(--sizes-65)` = `16.25rem`).
        sizes: quarterStepSpacing,
        spacing: quarterStepSpacing,
        zIndex: {
          modal: { value: "201" },
          modalBackdrop: { value: "200" },
        },
      },
    },
  },
});
