import { cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { WORKSPACES } from "../window-management/window-state";

type Props = {
  /** The workspace on screen. */
  current: string;
  /** The workspaces with something on them. */
  occupied: readonly string[];
  onSelect: (name: string) => void;
};

/**
 * The workspaces, at the left-hand end of the bar — sway's own bar, and the
 * same rule for which of them are on it: the ones with windows on them, and
 * the one being looked at whether or not it has any.
 *
 * The desktop keeps all ten all the time, which is the one place that
 * difference from sway would show. It does not show: an empty workspace
 * nobody is looking at is not here either.
 *
 * **A number in a ring**, which is the shape the author's waybar draws: a
 * circle the height of the bar's own text, clear until the pointer is over it
 * and filled for the one on screen. The circle is what makes the row legible
 * over a photograph at a glance — the marked one is a shape rather than a
 * shade of the same white as its neighbors — and it is the same circle for
 * all ten of them, which is what the type being set smaller than the bar's
 * buys: the tenth workspace is two digits, and a ring drawn around its
 * contents would be a lozenge.
 *
 * The control is a purpose-built `<button>` rather than the library's, for
 * the reason the tab-select control in the library's own `TabRail` is one:
 * what it needs is `aria-current` styling, which `Button` does not expose,
 * and `className` is private there, so it cannot be dressed from outside.
 * The bar's white and the shadow under it are inherited rather than declared
 * — a plain button takes the color and the font of the row it is in.
 */
export const Workspaces = ({ current, occupied, onSelect }: Props) => (
  <nav aria-label="Workspaces" className={listStyles}>
    {WORKSPACES.filter(
      (name) => name === current || occupied.includes(name),
    ).map((name) => (
      <button
        // The marked one is the one on screen, which is what `aria-current`
        // says on a navigation control — `disabled` would say it cannot be
        // reached, and pressing it is how `workspaceAutoBackAndForth` goes
        // back to the last one.
        aria-current={name === current ? "true" : undefined}
        className={workspaceStyles({ current: name === current })}
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

// Far enough apart that the ring around one is not read as touching the next,
// which is the whole of what the gap is doing: the circles are 1.5rem and the
// numbers in them are one glyph wide.
const listStyles = hstack({ gap: 2 });

const workspaceStyles = cva({
  base: {
    // The height of the bar's own text, which is what the circle is drawn
    // around: what is on the bar is one row of writing, and a workspace
    // number is a character of it that happens to be in a ring.
    blockSize: 6,
    // A ring that is there before the pointer is, in nothing. A border that
    // appeared on hover would move the number by a pixel as it arrived.
    border: "1px solid transparent",
    borderRadius: "full",
    cursor: "pointer",
    // A block rather than a centering flex box, which is what the trim below
    // needs: `text-box` is honored on a block container and quietly ignored
    // on a flex one, and a flex box centered the line rather than the figure.
    display: "block",
    // Set smaller than the bar's own text so that the tenth workspace — the
    // one two digits wide — has room inside a circle this size. The circle is
    // the point: a ring that took the width of what is written in it would be
    // a lozenge around `10` and a circle around the nine before it.
    fontSize: "sm",
    // And tabular figures, so `11` is the width of `10`: what is drawn around
    // them is the same ring either way, and a digit that changed width inside
    // it would sit off-center.
    fontVariantNumeric: "tabular-nums",
    inlineSize: 6,
    // Short enough that the line still fits the circle where the trim below
    // is not understood, which is the only thing it decides: with the trim,
    // where the figure sits does not depend on it.
    lineHeight: "tight",
    padding: 0,
    // The press, which is the one piece of feedback the pointer gets that is
    // not a color: the chip gives a little under it.
    scale: { _active: 0.92, base: 1 },
    // Across, which a block does not do for itself.
    textAlign: "center",
    // And down: this is what puts the figure on the circle rather than two
    // pixels above it. A line box is as tall as the font's ascent and
    // descent, and a digit has neither the accent that ascent leaves room
    // for nor the tail that descent does, so a box centered in the ring puts
    // the ink high in it. Trimming the box to the cap above and the baseline
    // below leaves exactly what is drawn, and what is drawn is what the ring
    // then closes around.
    textBox: "trim-both cap alphabetic",
    transition: `
      background-color {durations.fast} {easings.out},
      border-color {durations.fast} {easings.out},
      color {durations.fast} {easings.out},
      scale {durations.faster} {easings.out}
    `,
  },
  variants: {
    current: {
      false: {
        _hover: {
          // The ring the pointer draws, and a wash inside it. White rather
          // than a token, for the reason the bar's text is white: what is
          // behind this is the wallpaper, which does not flip with the theme.
          backgroundColor:
            "color-mix(in oklab, {colors.white} 15%, transparent)",
          borderColor: "color-mix(in oklab, {colors.white} 70%, transparent)",
        },
        backgroundColor: "transparent",
      },
      true: {
        backgroundColor: "white",
        // Dark on the chip, and black rather than `background` for the same
        // reason the fill is white rather than `foreground`: the chip is
        // white in either theme, so what is written on it cannot be a color
        // that turns white in one of them.
        color: "black",
        fontWeight: "bold",
        // The shadow is what lifts the bar's writing off a photograph. There
        // is no photograph behind this number — there is a white chip — and a
        // shadow on it only smudges the glyph.
        textShadow: "none",
      },
    },
  },
});
