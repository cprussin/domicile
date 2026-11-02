/// <reference path="./image.d.ts" />
// The built-in wallpaper photographs for each theme, served by Wikimedia
// Commons.
//
// - `Special:FilePath` serves a fixed file by title and `?width=` scales it,
//   so each URL is stable and cacheable.
// - The titles are in `commons-titles.ts`. All are public domain or CC0, so
//   no credit line is needed.
// - Remote URLs keep large JPEGs out of the repo. One small photograph per
//   theme ships in the repo and shows until a remote one loads.
//
// See `packages/manganese-wallpaper/docs/WALLPAPER.md`.

import type { Theme } from "@domicile-desktop/component-library/theme-core";

import { COMMONS_TITLES } from "./commons-titles";
import fallbackDark from "./fallback-dark.jpg";
import fallbackLight from "./fallback-light.jpg";

/**
 * Requested width: 4K, for every screen.
 *
 * The page renders at one `devicePixelRatio` across all displays, so there is
 * no per-screen size (see `screens/host-displays`). Width only, because
 * `object-fit: cover` handles the crop. Commons does not upscale narrower
 * files.
 */
const PHOTO_WIDTH = 3840;

/**
 * The Commons URL for the file `title` at {@link PHOTO_WIDTH}, such as
 * `commonsPhoto("Andromeda galaxy 2023.jpg")`.
 *
 * Defined before {@link DEFAULT_WALLPAPERS}, which calls it at module load.
 */
export const commonsPhoto = (title: string): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=${PHOTO_WIDTH.toString()}`;

/** Each theme's built-in photographs, used where the config sets none. */
export const DEFAULT_WALLPAPERS: Readonly<Record<Theme, readonly string[]>> = {
  dark: COMMONS_TITLES.dark.map(commonsPhoto),
  light: COMMONS_TITLES.light.map(commonsPhoto),
};

/** Each theme's photograph from the repository, shown until one loads. */
export const WALLPAPER_FALLBACKS: Record<Theme, string> = {
  dark: fallbackDark,
  light: fallbackLight,
};
