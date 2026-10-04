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
   * Test seam for the theme hook. Defaults to {@link useTheme}; consumers
   * never pass it.
   */
  useTheme?: () => ThemeControl;
};

/**
 * A dark/light theme toggle for the shell's chrome.
 *
 * There is no "system" option because Domicile is the system. A click asks
 * the compositor for the change; the page repaints when the answer arrives.
 * Throws when no `ThemeProvider` is mounted above it.
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

// A circular window holding the sun and moon slots.
//
// Sets no `color` so the icons inherit their surroundings' text color. The
// toggle often sits in a white bar over the wallpaper, which does not change
// with the theme; a `foreground` color would turn black there in light mode.
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

// The active icon sits at translateY(0); the inactive one is parked below the
// window at translateY(100%). `flipThemeWithAnimation` sequences a flip:
//
//   - Set: `data-theme-setting` on <html> moves every slot below, so the
//     active icon sinks.
//   - Wipe: both slots stay below, so the toggle is empty in both view
//     transition snapshots.
//   - Rise: `data-theme-setting` is removed and `data-theme-mode` changes, so
//     the new icon slides up. `outBack` gives it a small landing bounce.
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

// The parked icon is faded so the `color` transition runs with the transform
// and the rising icon brightens as it moves, not after it lands.
//
// The `color-mix` is repeated inline because Panda only extracts static
// literals. A shared const would silently emit no rule.

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
