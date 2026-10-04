// The wallpaper photographs for each theme, served by Wikimedia Commons.
//
// - `Special:FilePath` serves a fixed file by title and `?width=` scales it,
//   so each URL is stable and cacheable.
// - Dark skies for the dark theme, daylit landscapes for the light theme.
// - All are public domain (NASA, National Park Service, US Air Force), so no
//   credit line is needed.
// - Remote URLs keep large JPEGs out of the repo. Without a network the page
//   shows the theme's `background`.
//
// See `packages/shell-manganese/docs/WALLPAPER.md`.

import type { Theme } from "@domicile-desktop/component-library/theme-core";

const PHOTO_TITLES: Record<Theme, readonly string[]> = {
  dark: [
    // Webb's "Cosmic Cliffs": the rim of NGC 3324 in the Carina Nebula.
    "NASA’s Webb Reveals Cosmic Cliffs, Glittering Landscape of Star Birth.jpg",
    // "Celestial Fireworks", Hubble's 25th-anniversary image of Westerlund 2.
    "Celestial Fireworks - The Official Hubble 25th Anniversary Image (27925696572).jpg",
    // The Hubble Ultra-Deep Field. Square, but the crop loses nothing because
    // every part of it is galaxies.
    "Hubble ultra deep field high rez edit1.jpg",
    // Aurora borealis over Eielson Air Force Base, Alaska.
    "Aurora borealis over Eielson Air Force Base, Alaska.jpg",
  ],
  light: [
    // Denali, from the national park that shares its name.
    "Denali, Denali National Park and Preserve.jpg",
    // The Grand Canyon under the fog inversion of December 2013.
    "131201 Grand Canyon Shots 0707 - Flickr - Grand Canyon NPS.jpg",
  ],
};

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
 * The Commons URL for `title` at {@link PHOTO_WIDTH}.
 *
 * Defined before {@link WALLPAPER_PHOTOS}, which calls it at module load.
 */
const photoUrl = (title: string): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=${PHOTO_WIDTH.toString()}`;

/** Each theme's photographs, in the order the desktop shows them. */
export const WALLPAPER_PHOTOS: Record<Theme, readonly string[]> = {
  dark: PHOTO_TITLES.dark.map(photoUrl),
  light: PHOTO_TITLES.light.map(photoUrl),
};
