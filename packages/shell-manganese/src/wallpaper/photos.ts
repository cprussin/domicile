// The photographs the desktop rotates through, and where they come from.
//
// Lorem Picsum, which serves a fixed set of Unsplash photographs cropped to
// whatever size the path asks for. A *seeded* URL rather than its random
// endpoint: a seed is one photograph for ever, so the desktop comes up with the
// same pictures every time, the browser can cache them, and what the rotation
// shows is something a reader of this file can go and look at.
//
// A remote URL rather than files in this repository is the trade this shell is
// making: it costs a desktop with no network its wallpaper — the page comes up
// on the theme's own `background` — and it saves a source repository tens of
// megabytes of JPEG that nothing but the reference chrome would ever read. A
// shell that wants its own pictures owns its own list.
//
// The subject is not promised: Picsum picks by hashing the seed, so these are
// six photographs rather than six landscapes.

/** How many photographs go by before the rotation comes back round. */
const PHOTO_COUNT = 6;

/**
 * 4K, for every screen rather than for one of them.
 *
 * There is no per-screen size to ask for: the chrome is one page spanning the
 * whole desktop at one `devicePixelRatio`, and a display's `scale` is what
 * *clients* on it draw at rather than what this page renders at — see
 * `screens/host-displays`. So the request is one generous size and `object-fit: cover`
 * does what it has always done for a wallpaper, which is fit a photograph to a
 * screen that is not its shape.
 */
const PHOTO_WIDTH = 3840;
const PHOTO_HEIGHT = 2160;

/** The photographs, in the order the desktop shows them. */
export const WALLPAPER_PHOTOS: readonly string[] = Array.from(
  { length: PHOTO_COUNT },
  (_, index) =>
    `https://picsum.photos/seed/domicile-${index.toString()}/${PHOTO_WIDTH.toString()}/${PHOTO_HEIGHT.toString()}`,
);
