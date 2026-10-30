import { cva } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";

type Props = {
  /** The workspace this screen shows. */
  current: string;
  /** Whether this screen has keyboard focus, which decides `current`'s fill. */
  focused: boolean;
  onSelect: (name: string) => void;
  /** This screen's workspaces, in order. */
  workspaces: readonly string[];
};

/**
 * The workspace switcher at the bar's start. Like sway's bar, it shows this
 * screen's workspaces that have windows, plus the one on screen.
 *
 * Each is a number. The focused workspace sits on a lit square like a hovered
 * bar button; one visible on another screen gets a fainter square; the rest
 * are dimmed until hovered.
 *
 * A plain `<button>` rather than the library's `Button`, which does not support
 * `aria-current` styling or an external `className`. It inherits the bar's
 * color and font.
 */
export const Workspaces = ({
  current,
  focused,
  onSelect,
  workspaces,
}: Props) => (
  <nav aria-label="Workspaces" className={listStyles}>
    {workspaces.map((name) => (
      <button
        // `aria-current` marks the visible workspace. `disabled` would be
        // wrong: a press on it switches back via `workspaceAutoBackAndForth`.
        aria-current={name === current ? "true" : undefined}
        className={workspaceStyles({
          shown: shownAs(name === current, focused),
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

const listStyles = hstack({ gap: 0.5 });

const workspaceStyles = cva({
  base: {
    _hover: { backgroundColor: "fillOverPhoto", color: "white" },
    backgroundColor: "transparent",
    blockSize: 6,
    borderRadius: "lg",
    borderStyle: "none",
    color: "color-mix(in oklab, {colors.white} 55%, transparent)",
    cursor: "pointer",
    // A block, not flex: `text-box` trim below works only on block containers.
    display: "block",
    // 13px, matching the clock.
    fontSize: "ui",
    // Tabular figures keep every number the same width.
    fontVariantNumeric: "tabular-nums",
    fontWeight: "medium",
    // Only matters where `text-box` trim is unsupported.
    lineHeight: "tight",
    minInlineSize: 6,
    paddingBlock: 0,
    paddingInline: 2,
    // Pressed feedback that is not just color.
    scale: { _active: 0.92, base: 1 },
    textAlign: "center",
    // Center vertically. Trimming the line box to cap height and baseline
    // leaves only the glyph, so the digit sits centered rather than high.
    textBox: "trim-both cap alphabetic",
    transition: `
      background-color {durations.fast} {easings.out},
      color {durations.fast} {easings.out},
      scale {durations.faster} {easings.out}
    `,
  },
  variants: {
    shown: {
      focused: {
        backgroundColor: "fillOverPhoto",
        color: "white",
        fontWeight: "semibold",
      },
      hidden: {},
      // Visible on another screen: a fainter square.
      visible: {
        backgroundColor: "color-mix(in oklab, {colors.white} 8%, transparent)",
        color: "white",
      },
    },
  },
});

const shownAs = (
  current: boolean,
  focused: boolean,
): "focused" | "hidden" | "visible" => {
  if (current) {
    return focused ? "focused" : "visible";
  } else {
    return "hidden";
  }
};
