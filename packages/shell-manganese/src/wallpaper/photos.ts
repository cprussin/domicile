// The wallpaper photographs for each theme, served by Wikimedia Commons.
//
// - `Special:FilePath` serves a fixed file by title and `?width=` scales it,
//   so each URL is stable and cacheable.
// - Dark space photos for the dark theme, bright nature scenes for the light
//   theme.
// - All are public domain or CC0, so no credit line is needed.
// - Remote URLs keep large JPEGs out of the repo. One small photograph per
//   theme ships in the repo and shows until a remote one loads.
//
// See `packages/shell-manganese/docs/WALLPAPER.md`.

import type { Theme } from "@domicile-desktop/component-library/theme-core";

import fallbackDark from "./fallback-dark.jpg";
import fallbackLight from "./fallback-light.jpg";

const PHOTO_TITLES: Record<Theme, readonly string[]> = {
  // Galaxies, nebulae and deep fields from Hubble, Webb, Spitzer and Chandra.
  // Mostly black, so the desktop stays dark.
  dark: [
    "Hubble ultra deep field high rez edit1.jpg",
    "Andromeda galaxy 2023.jpg",
    "Hubble reveals the Ring Nebula’s true shape.jpg",
    "Ultraviolet image of the Cygnus Loop Nebula crop.jpg",
    "Webb Uncovers New Details in Pandora’s Cluster (weic2305a).jpeg",
    "Stephan's Quintet taken by James Webb Space Telescope.jpg",
    "Helix Nebula - Unraveling at the Seams.jpg",
    "Southern Ring Nebula by Webb Telescope (2022).jpg",
    "Visible-Light and X-Ray Composite Image of Galaxy Cluster 1E 0657-556 (2006-39-1981).jpg",
    "Messier 81 HST.jpg",
    "NGC 2683 Spiral galaxy.jpg",
    "M104 ngc4594 sombrero galaxy hi-res.jpg",
    "Hubble2005-01-barred-spiral-galaxy-NGC1300.jpg",
    "Comets Kick up Dust in Helix Nebula (PIA09178).jpg",
    "The Spitzer Space Telescope's view of W40.jpg",
    "NGC 1275 Hubble.jpg",
    "JWST image of the HH212 protostellar jet (53303238669).jpg",
  ],
  // Bright daylit nature: mountains, valleys, forests and fields, then
  // beaches and sand dunes.
  light: [
    "Denali, Denali National Park and Preserve.jpg",
    "131201 Grand Canyon Shots 0707 - Flickr - Grand Canyon NPS.jpg",
    "Mount Rainier from the Longmire Meadow (243429ef-e191-49eb-a3f9-cad1cfda80dd).jpeg",
    "Scenic view of Yosemite Valley (Unsplash).jpg",
    "Symmetry in Yosemite (Unsplash).jpg",
    "The Valley (Unsplash).jpg",
    "Grand Teton National Park - HCP - October 31, 2022 - 250.jpg",
    "USA Arches National Park en Utah Window.jpg",
    "Fog in Yosemite (Unsplash).jpg",
    "Snyder Lake in Glacier National Park.jpg",
    "Mount Ida chain Messara plain from Phaistos Crete Greece.jpg",
    "Sunflowers and Wheat Fields Under Summer Sky.jpg",
    "Field-summer-countryside-autumn (24030454920).jpg",
    "San Juan Valley.jpg",
    "Bilberry bush and moss in Gullmarsskogen ravine.jpg",
    "Fishing boats, morning, Beach, Rincon de la Victoria, Andalusia, Spain.jpg",
    "Vladimir Kudinov 2016-01-06 (Unsplash).jpg",
    "Great Smoky Mountains National Park (5723903f-dd9c-4a28-b652-5b77bd7f4841).jpg",
    "USVI IMG 5166 - Tropical foliage frames a serene beach and turquoise water with palm trees swaying gently in the breeze.jpg",
    "Great Sand Dunes National Park and Preserve, United States (Unsplash).jpg",
    "Mojave Preserve Kelso Dunes (49461651207).jpg",
    "Paradise beach (Unsplash).jpg",
    "Wallabi Beach 1.jpg",
    "Utah Dunes Landscape - West Desert District.jpg",
    "Dry Desolation (Unsplash).jpg",
    "Ocean washing on the beach (Unsplash).jpg",
    "Desert Dunes in New Mexico (Unsplash).jpg",
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

/** Each theme's photograph from the repository, shown until one loads. */
export const WALLPAPER_FALLBACKS: Record<Theme, string> = {
  dark: fallbackDark,
  light: fallbackLight,
};
