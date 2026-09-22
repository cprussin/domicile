import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";

import { css, cx } from "../../styled-system/css";
import type { ThemeControl } from "./ThemeProvider";
import { useTheme } from "./ThemeProvider";
import type { Theme } from "./theme-core";

const LABELS: Record<Theme, string> = {
  dark: "Dark theme — click for light",
  light: "Light theme — click for dark",
};

type Props = {
  /**
   * The theme-context hook to read `{ theme, flip }` from — injectable so
   * tests and stories can drive the toggle without mounting a provider. Defaults
   * to the real {@link useTheme}, so consumers never pass it.
   */
  useTheme?: () => ThemeControl;
};

/**
 * A two-state theme toggle: dark ⇄ light.
 *
 * **There is no third position, and its absence is the design.** Every other
 * theme control offers "follow the system" because it belongs to a program
 * running *on* a desktop. This one is on the desktop's own chrome, and there is
 * nothing above Domicile whose preference it could follow — a `system` here
 * would be the desk deferring to itself.
 *
 * Self-contained: it reads the theme and the `flip` from the context the app's
 * `Provider` supplies, so consumers just render `<ThemeSwitch />` — no props. A
 * click is a *request*: what repaints the page is the desk answering, which is
 * also what reaches the other monitors and the desk's Wayland clients. It
 * throws (via the default hook) when there's no provider above it, so a missing
 * one is a loud wiring bug rather than a silent default. The `useTheme` prop is
 * a test seam only.
 */
export const ThemeSwitch = ({ useTheme: useThemeHook = useTheme }: Props) => {
  const { flip, theme } = useThemeHook();
  return (
    <button
      aria-label={LABELS[theme]}
      className={buttonStyles}
      data-theme-mode={theme}
      onClick={flip}
      title={LABELS[theme]}
      type="button"
    >
      <span aria-hidden className={cx(slotStyles, sunSlotStyles)}>
        <SunIcon size={16} weight="fill" />
      </span>
      <span aria-hidden className={cx(slotStyles, moonSlotStyles)}>
        <MoonIcon size={16} weight="fill" />
      </span>
    </button>
  );
};

// The toggle button — a small circular window. Holds two absolutely-positioned
// slots (sun / moon), with the currently-active slot at center and the other
// parked below; the flip moves them via `flipThemeWithAnimation`.
//
// IT STATES NO `color`, WHICH IS THE ONE DECISION IN HERE. Both icons are
// drawn in `currentcolor` and the parked one dims a `color-mix` of it, so the
// toggle comes out in whatever its surroundings are lettered in. That is not
// tidiness: this thing's home is a bar drawn over a photograph, in white,
// because a wallpaper does not flip with the theme — and a `foreground` here
// would go black over that photograph the moment the desk went light. In a
// panel or a card it inherits the panel's text color and looks like the text
// beside it, which is the same rule arriving at the other answer.
const buttonStyles = css({
  _hover: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 10%, transparent)",
  },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  cursor: "pointer",
  display: "inline-block",
  flexShrink: 0,
  inlineSize: 7,
  overflow: "hidden",
  padding: 0,
  position: "relative",
  transition: "background-color {durations.fast} {easings.default}",
});

// Two icons share a single circular window. The currently-active icon
// sits at translateY(0); the inactive one is parked at translateY(100%)
// (just below the window, clipped by the button's overflow:hidden) so a
// flip plays out as sun-sets-then-moon-rises rather than a single
// upward roll. The two-phase sequencing is driven from
// `flipThemeWithAnimation`:
//
//   - Phase 1 (set): `data-theme-setting` is added to <html>. The
//     descendant rule below forces every slot to translateY(100%), so
//     the currently-active slot transitions from center down to below
//     while the inactive one stays put. The override also swaps the
//     transform easing to `outQuart` and shortens the duration to
//     `{durations.fast}`, so the sinking icon moves fast off the
//     start and decelerates into the bottom — decisive, not a glide.
//   - The theme-flip wipe runs between set and rise (also orchestrated
//     in `flipThemeWithAnimation`). `data-theme-setting` stays on
//     across the wipe so both slots remain at translateY(100%) — the
//     toggle area is empty in both root snapshots and the wipe
//     carries only the page background through the transition.
//   - Phase 2 (rise): `data-theme-setting` is removed and
//     `data-theme-mode` flips to the new value. The new active
//     slot's target becomes translateY(0); since its current rendered
//     position is translateY(100%), it slides up into center. The
//     base transition's `outBack` easing overshoots center by ~15%
//     before settling, giving the rise a visible landing bounce while
//     the icon's filled shape stays inside the round button.
//
// With the inactive slot parked at +100%, nothing traverses the visible
// window on its way anywhere — no wraparound flash to hide — so opacity
// is uniformly 1 and only the transform and color transitions are wired
// up.
const slotStyles = css({
  alignItems: "center",
  blockSize: "100%",
  display: "inline-flex",
  "html[data-theme-setting] [data-theme-mode] > &": {
    transform: "translateY(100%) !important",
    transition:
      "transform {durations.fast} {easings.outQuart}, color {durations.normal} {easings.default}",
  },
  inlineSize: "100%",
  insetBlockStart: 0,
  insetInlineStart: 0,
  justifyContent: "center",
  pointerEvents: "none",
  position: "absolute",
  transition:
    "transform {durations.normal} {easings.outBack}, color {durations.normal} {easings.default}",
});

// `currentcolor` for the icon at center and a faded `currentcolor` for the one
// parked below — see the button above for why neither is a token. The parked
// icon is out of the window and clipped, so the fade is not there to be read:
// it is what keeps the `color` transition running in step with the transform,
// so the rising icon arrives lit rather than lighting up once it has landed.
//
// The mix is written out at all four sites rather than hoisted to a const,
// because Panda extracts CSS by reading the literal inside these calls: a
// reference it cannot resolve statically produces the class name with no rule
// behind it, and the symptom would be a toggle whose parked icon is as bright
// as the lit one with nothing in the build saying so.

const sunSlotStyles = css({
  "[data-theme-mode=dark] &": {
    color: "color-mix(in oklab, currentcolor 40%, transparent)",
    transform: "translateY(100%)",
  },
  "[data-theme-mode=light] &": {
    color: "currentcolor",
    transform: "translateY(0)",
  },
});

const moonSlotStyles = css({
  "[data-theme-mode=dark] &": {
    color: "currentcolor",
    transform: "translateY(0)",
  },
  "[data-theme-mode=light] &": {
    color: "color-mix(in oklab, currentcolor 40%, transparent)",
    transform: "translateY(100%)",
  },
});
