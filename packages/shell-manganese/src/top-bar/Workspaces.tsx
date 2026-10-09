import { cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

type Props = {
  /** The workspace this screen shows. */
  current: string;
  /** Whether this screen has keyboard focus, which decides `current`'s fill. */
  focused: boolean;
  onSelect: (name: string) => void;
  /** Workspaces holding a window that asked for the keyboard. */
  urgent: readonly string[];
  /** This screen's workspaces, in order. */
  workspaces: readonly string[];
};

/**
 * The workspace switcher at the bar's start. Like sway's bar, it shows this
 * screen's workspaces that have windows, plus the one on screen.
 *
 * Each is a number in a ring, filled for the focused workspace and outlined for
 * one visible on another screen (sway's `focused_workspace` versus
 * `active_workspace`). A hidden one holding a window that asked for the
 * keyboard is filled in the warning color (sway's `urgent_workspace`). The
 * ring marks the current workspace by shape, not just shade, so it stands out
 * over a wallpaper. Text is set smaller than the bar's so `10` fits in the same
 * circle.
 *
 * A plain `<button>` rather than the library's `Button`, which does not support
 * `aria-current` styling or an external `className`. It inherits the bar's
 * color and font.
 */
export const Workspaces = ({
  current,
  focused,
  onSelect,
  urgent,
  workspaces,
}: Props) => (
  <nav aria-label="Workspaces" className={listStyles}>
    {workspaces.map((name) => (
      <button
        // `aria-current` marks the visible workspace. `disabled` would be
        // wrong: a press on it switches back via `workspaceAutoBackAndForth`.
        aria-current={name === current ? "true" : undefined}
        className={workspaceStyles({
          shown: shownAs(name === current, focused, urgent.includes(name)),
        })}
        key={name}
        onClick={() => {
          onSelect(name);
        }}
        type="button"
      >
        {name}
      </button>
    ))}
  </nav>
);

// Enough gap that adjacent rings do not appear to touch.
const listStyles = hstack({ gap: 2 });

const workspaceStyles = cva({
  base: {
    // The height of the bar's text, so the ring sits in the line.
    blockSize: 6,
    // A transparent border from the start, so the hover border does not shift
    // the number.
    border: "1px solid transparent",
    borderRadius: "full",
    cursor: "pointer",
    // A block, not flex: `text-box` trim below works only on block containers.
    display: "block",
    // Smaller than the bar's text so two digits fit in the circle.
    fontSize: "sm",
    // Tabular figures keep every number the same width, so all stay centered.
    fontVariantNumeric: "tabular-nums",
    inlineSize: 6,
    // Only matters where `text-box` trim is unsupported; it keeps the line
    // within the circle.
    lineHeight: "tight",
    padding: 0,
    // Pressed feedback that is not just color.
    scale: { _active: 0.92, base: 1 },
    textAlign: "center",
    // Center vertically. Trimming the line box to cap height and baseline
    // leaves only the glyph, so the digit sits centered in the ring rather than
    // high.
    textBox: "trim-both cap alphabetic",
    transition: `
      background-color {durations.fast} {easings.out},
      border-color {durations.fast} {easings.out},
      color {durations.fast} {easings.out},
      scale {durations.faster} {easings.out}
    `,
  },
  variants: {
    shown: {
      focused: {
        backgroundColor: "white",
        // Black, not `background`: the chip is white in both themes, so its
        // text cannot follow the theme.
        color: "black",
        fontWeight: "bold",
        // No text shadow: on a white chip it only smudges the glyph.
        textShadow: "none",
      },
      hidden: {
        _hover: {
          // Hover ring and wash. White, not a token, because the wallpaper
          // behind it does not change with the theme.
          backgroundColor:
            "color-mix(in oklab, {colors.white} 15%, transparent)",
          borderColor: "color-mix(in oklab, {colors.white} 70%, transparent)",
        },
        backgroundColor: "transparent",
      },
      // Hidden, with a window that asked for the keyboard. Black text, as on
      // the white chip, since the fill does not follow the theme's text.
      urgent: {
        backgroundColor: "warning",
        color: "black",
        fontWeight: "bold",
        textShadow: "none",
      },
      // Visible on another screen: the hover ring without the fill.
      visible: {
        _hover: {
          backgroundColor:
            "color-mix(in oklab, {colors.white} 15%, transparent)",
        },
        backgroundColor: "transparent",
        borderColor: "color-mix(in oklab, {colors.white} 70%, transparent)",
      },
    },
  },
});

const shownAs = (
  current: boolean,
  focused: boolean,
  urgent: boolean,
): "focused" | "hidden" | "urgent" | "visible" => {
  if (current) {
    return focused ? "focused" : "visible";
  } else {
    return urgent ? "urgent" : "hidden";
  }
};
