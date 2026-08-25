// What the keys do, written on the desktop until there is a window on it.
//
// This shell has no widgets to find and no menu to open, so an empty desktop
// is a blank page that answers only to Alt and says so nowhere — the bindings
// lived in a README, which is the one place a user of the desktop is not
// looking. They are prose here rather than read off the code that implements
// them: `window-gestures.ts` and `terminal-shortcut.ts` own what the keys do,
// and this owns how it reads, so a binding that changes there changes here.

import { css } from "../styled-system/css";
import { center, grid } from "../styled-system/patterns";

/** Every combination this shell answers to, hardest to guess last. */
const KEYBINDINGS = [
  { chord: "Alt + press", means: "raise" },
  { chord: "Alt + drag", means: "move (and raise)" },
  { chord: "Alt + right-drag", means: "resize (and raise)" },
  { chord: "Alt + Enter", means: "open a terminal" },
] as const;

/**
 * Draw the keybindings on `root`, for as long as it has no window on it.
 *
 * Appended once and never touched again — it is the page's background rather
 * than a panel, so nothing else in the shell has to know it is here. It takes
 * no pointer event, and it is unpainted for as long as `root` has a window on
 * it, which is what makes it a background rather than something drawn over the
 * desktop. It hides for the windows appended after it and not for any already
 * there, so it goes on before the first one.
 */
export const installKeybindingBackground = (root: HTMLElement): void => {
  const background = document.createElement("div");
  background.className = backgroundStyles;
  const legend = document.createElement("dl");
  legend.className = legendStyles;
  legend.append(...KEYBINDINGS.flatMap(keybindingRow));
  background.append(legend);
  root.append(background);
};

/** One binding, as the two cells of a row: the chord, and what it does. */
const keybindingRow = ({
  chord,
  means,
}: (typeof KEYBINDINGS)[number]): readonly HTMLElement[] => [
  cell("dt", chord, chordStyles),
  cell("dd", means, meansStyles),
];

const cell = (
  tag: "dd" | "dt",
  text: string,
  className: string,
): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};

const backgroundStyles = center({
  // Gone as soon as a window is, and by `display` rather than a stacking order
  // because no order on this page reaches the compositor: where it draws a
  // client's own buffer the window is a transparent hole, and the chrome is
  // one texture drawn over every client, so anything painted across that hole
  // — this legend included — lands on top of the live window. The compositor
  // can band the chrome by depth (`stacking.rs`), but no message tells it
  // where the chrome's own depths are, so every frame is still the all-above
  // case. The tag is `APP_TAG_NAME`, spelled out because a selector is a
  // literal Panda extracts at build time, and the windows are the siblings
  // appended after this.
  "&:has(~ domicile-app)": {
    display: "none",
  },
  color: "muted",
  fontSize: "sm",
  // Paint, never a hit target, so nothing about the gestures can depend on
  // where this happens to be: the rule above already keeps it out of the way
  // of anything a window is involved in, and this keeps it out of the way of
  // whatever the rule becomes. The selection is a live case rather than a
  // hypothetical one — the desktop it is painted on has no windows, so a plain
  // drag across it is nobody's gesture, and would take the legend with it.
  inset: 0,
  pointerEvents: "none",
  position: "fixed",
  userSelect: "none",
});

const legendStyles = grid({
  columnGap: 4,
  // Two columns, each as wide as its widest cell — the chords are one column
  // of a legend, not half the desktop.
  gridTemplateColumns: "auto auto",
  rowGap: 1,
});

// A chord is what the component library's `Kbd` is for, and manganese says the
// one thing both shells have — Alt+Enter — through it. Not reachable from
// here: `Kbd` is a React component and this shell builds its DOM by hand, so a
// chord is a `dt` in the preset's mono face. It is set apart differently, too,
// and deliberately: `Kbd` is a chip inside a sentence, where mono and a border
// are what mark it out; here the chords are the column a reader scans, so they
// take the foreground and the meanings beside them are the gloss.
const chordStyles = css({
  color: "foreground",
  fontFamily: "mono",
  textAlign: "end",
});

const meansStyles = css({
  textAlign: "start",
});
