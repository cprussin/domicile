import { CircleHalfIcon } from "@phosphor-icons/react/dist/ssr/CircleHalf";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";

import { css, cx } from "../../styled-system/css";
import type { ThemeControl } from "./ThemeProvider";
import { useTheme } from "./ThemeProvider";
import type { ThemePreference } from "./theme-core";

// Pre-paint helpers: apps apply the persisted theme to `<html>` before React
// mounts (see the app's renderer entry), then mount a `Provider` for runtime.
export { applyPreference, loadPreference } from "./ThemeProvider";

const LABELS: Record<ThemePreference, string> = {
  dark: "Dark theme — click for system",
  light: "Light theme — click for dark",
  system: "System theme — click for light",
};

type Props = {
  /**
   * The theme-context hook to read `{ preference, cycle }` from — injectable so
   * tests and stories can drive the toggle without mounting a provider. Defaults
   * to the real {@link useTheme}, so consumers never pass it.
   */
  useTheme?: () => ThemeControl;
};

/**
 * A compact three-state theme toggle (light → dark → system). Self-contained: it
 * reads the current preference and the animated `cycle` from the theme context
 * the app's `Provider` supplies, so consumers just render `<ThemeSwitch />` — no
 * props. It throws (via the default hook) when there's no provider above it, so a
 * missing one is a loud wiring bug, not a silent default. The `useTheme` prop is
 * a test seam only.
 */
export const ThemeSwitch = ({ useTheme: useThemeHook = useTheme }: Props) => {
  const { cycle, preference } = useThemeHook();
  return (
    <button
      aria-label={LABELS[preference]}
      className={buttonStyles}
      data-theme-preference={preference}
      onClick={cycle}
      title={LABELS[preference]}
      type="button"
    >
      <span aria-hidden className={cx(slotStyles, sunSlotStyles)}>
        <SunIcon size={16} weight="fill" />
      </span>
      <span aria-hidden className={cx(slotStyles, moonSlotStyles)}>
        <MoonIcon size={16} weight="fill" />
      </span>
      <span aria-hidden className={cx(slotStyles, systemSlotStyles)}>
        <CircleHalfIcon size={16} weight="fill" />
      </span>
    </button>
  );
};

// The toggle button — a small circular window inside the sidebar's
// user row. Holds three absolutely-positioned slots (sun / moon /
// system), with the currently-active slot at center and the others
// parked below; the cycle moves them via `cycleThemeWithAnimation`.
const buttonStyles = css({
  _hover: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 10%, transparent)",
  },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "muted",
  cursor: "pointer",
  display: "inline-block",
  flexShrink: 0,
  inlineSize: 7,
  overflow: "hidden",
  padding: 0,
  position: "relative",
  transition: "background-color {durations.fast} {easings.default}",
});

// Three icons share a single circular window. The currently-active icon
// sits at translateY(0); every inactive icon is parked at translateY(100%)
// (just below the window, clipped by the button's overflow:hidden) so a
// cycle plays out as sun-sets-then-moon-rises rather than a single
// upward roll. The two-phase sequencing is driven from
// `cycleThemeWithAnimation`:
//
//   - Phase 1 (set): `data-theme-setting` is added to <html>. The
//     descendant rule below forces every slot to translateY(100%), so
//     the currently-active slot transitions from center down to below
//     while inactives stay put. The override also swaps the transform
//     easing to `outQuart` and shortens the duration to
//     `{durations.fast}`, so the sinking icon moves fast off the
//     start and decelerates into the bottom — decisive, not a glide.
//   - The theme-flip wipe runs between set and rise (also orchestrated
//     in `cycleThemeWithAnimation`). `data-theme-setting` stays on
//     across the wipe so every slot remains at translateY(100%) — the
//     toggle area is empty in both root snapshots and the wipe
//     carries only the page background through the transition.
//   - Phase 2 (rise): `data-theme-setting` is removed and
//     `data-theme-preference` flips to the new value. The new active
//     slot's target becomes translateY(0); since its current rendered
//     position is translateY(100%), it slides up into center. The
//     base transition's `outBack` easing overshoots center by ~15%
//     before settling, giving the rise a visible landing bounce while
//     the icon's filled shape stays inside the round button.
//
// With every inactive parked at the same +100% offset, the third icon
// in a cycle step doesn't traverse the visible window at all — no
// wraparound flash to hide — so opacity is uniformly 1 and only the
// transform and color transitions are wired up.
const slotStyles = css({
  alignItems: "center",
  blockSize: "100%",
  display: "inline-flex",
  "html[data-theme-setting] [data-theme-preference] > &": {
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

const sunSlotStyles = css({
  "[data-theme-preference=dark] &": {
    color: "muted",
    transform: "translateY(100%)",
  },
  "[data-theme-preference=light] &": {
    color: "foreground",
    transform: "translateY(0)",
  },
  "[data-theme-preference=system] &": {
    color: "muted",
    transform: "translateY(100%)",
  },
});

const moonSlotStyles = css({
  "[data-theme-preference=dark] &": {
    color: "foreground",
    transform: "translateY(0)",
  },
  "[data-theme-preference=light] &": {
    color: "muted",
    transform: "translateY(100%)",
  },
  "[data-theme-preference=system] &": {
    color: "muted",
    transform: "translateY(100%)",
  },
});

const systemSlotStyles = css({
  "[data-theme-preference=dark] &": {
    color: "muted",
    transform: "translateY(100%)",
  },
  "[data-theme-preference=light] &": {
    color: "muted",
    transform: "translateY(100%)",
  },
  "[data-theme-preference=system] &": {
    color: "foreground",
    transform: "translateY(0)",
  },
});
