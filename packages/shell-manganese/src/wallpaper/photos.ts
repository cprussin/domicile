// The photographs the desktop rotates through, and where they come from.
//
// Wikimedia Commons, by file title. `Special:FilePath` serves the file a title
// names and `?width=` has Wikimedia's own thumbnailer scale it, so an entry
// here is one photograph for ever, the browser can cache it, and what the
// rotation shows is something a reader of this file can go and look at.
//
// **The subject is chosen here.** That is the whole reason this is a list of
// titles rather than a seeded placeholder service: a seed pins the photograph
// but not what is in it, so a rotation built on one is six photographs rather
// than six of anything. These are three from orbit and three from the ground,
// because a desktop is a thing you look at all day.
//
// All six are public domain — NASA, the National Park Service, the US Air
// Force — so showing one owes no credit line, which matters for a surface that
// has nowhere to put one.
//
// A remote URL rather than files in this repository is the trade this shell is
// making: it costs a desktop with no network its wallpaper — the page comes up
// on the theme's own `background` — and it saves a source repository tens of
// megabytes of JPEG that nothing but the reference chrome would ever read. A
// shell that wants its own pictures owns its own list.

const PHOTO_TITLES: readonly string[] = [
  // Webb's "Cosmic Cliffs": the rim of NGC 3324 in the Carina Nebula.
  "NASA’s Webb Reveals Cosmic Cliffs, Glittering Landscape of Star Birth.jpg",
  // "Celestial Fireworks", Hubble's 25th-anniversary image of Westerlund 2.
  "Celestial Fireworks - The Official Hubble 25th Anniversary Image (27925696572).jpg",
  // The Hubble Ultra-Deep Field. Square, and the one photograph here that
  // loses nothing to the crop: every part of it is more galaxies.
  "Hubble ultra deep field high rez edit1.jpg",
  // Denali, from the national park that shares its name.
  "Denali, Denali National Park and Preserve.jpg",
  // Aurora borealis over Eielson Air Force Base, Alaska.
  "Aurora borealis over Eielson Air Force Base, Alaska.jpg",
  // The Grand Canyon under the fog inversion of December 2013.
  "131201 Grand Canyon Shots 0707 - Flickr - Grand Canyon NPS.jpg",
];

/**
 * 4K wide, for every screen rather than for one of them.
 *
 * There is no per-screen size to ask for: the chrome is one page spanning the
 * whole desktop at one `devicePixelRatio`, and a display's `scale` is what
 * *clients* on it draw at rather than what this page renders at — see
 * `screens/host-displays`. So the request is one generous width and
 * `object-fit: cover` does what it has always done for a wallpaper, which is
 * fit a photograph to a screen that is not its shape.
 *
 * Width alone, because Commons scales to fit: a height here would be a second
 * constraint on a photograph whose shape is already not the desktop's, and the
 * crop is the layer's job. Wikimedia does not upscale, so a file narrower than
 * this arrives at its own size rather than blown up.
 */
const PHOTO_WIDTH = 3840;

/** The photographs, in the order the desktop shows them. */
export const WALLPAPER_PHOTOS: readonly string[] = PHOTO_TITLES.map(
  (title) =>
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=${PHOTO_WIDTH.toString()}`,
);
