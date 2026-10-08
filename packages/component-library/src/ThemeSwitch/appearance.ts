import type { Appearance } from "@domicile-desktop/sdk/appearance";

import { token } from "../../styled-system/tokens";

/** The custom property in a `var(--name)` reference. */
const customProperty = (reference: string): string => {
  const property = /^var\((?<property>--[\w-]+)\)$/u.exec(reference)?.groups
    ?.property;
  if (property === undefined) {
    throw new Error(`${reference} does not name a custom property`);
  } else {
    return property;
  }
};

/**
 * The custom property behind the `accent` token. Panda hashes it, so it is
 * read from the token's reference.
 */
const ACCENT_PROPERTY = customProperty(token.var("colors.accent"));

/**
 * Applies the config's accent, contrast and motion to `<html>`, where the
 * preset's `accent` token, `_contrastHigh` condition and reduced-motion rules
 * read them. The accent replaces both themes' own.
 */
export const applyAppearance = (
  { accentColor, highContrast, reducedMotion }: Appearance,
  root: HTMLElement = document.documentElement,
): void => {
  if (accentColor === undefined) {
    root.style.removeProperty(ACCENT_PROPERTY);
  } else {
    root.style.setProperty(ACCENT_PROPERTY, accentColor);
  }
  if (highContrast) {
    root.setAttribute("data-contrast", "high");
  } else {
    root.removeAttribute("data-contrast");
  }
  root.toggleAttribute("data-reduced-motion", reducedMotion);
};
