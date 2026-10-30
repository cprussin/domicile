/** The custom property the preset's `fonts.body` token reads first. */
const DESKTOP_FONT = "--desktop-font";

/**
 * Draws the desktop's text in `family`, a face installed on the computer or
 * Inter, which `inter.css` ships. A blank name draws Inter.
 */
export const applyFont = (
  family: string,
  root: HTMLElement = document.documentElement,
): void => {
  const name = family.trim();
  if (name === "") {
    root.style.removeProperty(DESKTOP_FONT);
  } else {
    root.style.setProperty(DESKTOP_FONT, quoted(name));
  }
};

/** `name` as a CSS string, so any name is one family. */
const quoted = (name: string): string =>
  `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
