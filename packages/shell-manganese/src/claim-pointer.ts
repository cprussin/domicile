// Where this chrome takes the pointer over the windows.
//
// The compositor hit-tests rectangles. It knows where each window is, because
// the page reports every `<domicile-app>` element's box — and it knows nothing
// at all about what the page painted *over* one. A floating window's title bar
// is exactly that: page pixels lying across whatever the window it names
// happens to cascade over. Without this the press on a bar goes to the window
// underneath, which focuses that window, which raises it — so clicking the
// front window's title bar raises the one behind it and the bar never hears
// the click.
//
// `pointer-events: none` on the window is the other half of this and cannot
// answer it: it makes a *whole* window inert, which is right for a menu or a
// dialog drawn across all of it, and wrong for a bar covering the top thirty
// pixels of one window and none of the window beside it. A window has one
// flag; the pointer has a position.
//
// So the page says where it takes the pointer and at what depth, and the
// compositor gives the press to whichever is on top there — which is what the
// user is looking at.

import type { PointerRegion } from "@domicile/chrome-sdk/chrome-message";
import type { Measure } from "@domicile/chrome-sdk/measure";

/** Marks an element as taking the pointer over whatever it covers. */
export const CLAIMS_POINTER = "data-claims-pointer";

/**
 * Every marked element, as the regions to claim.
 *
 * Read out of the DOM rather than assembled from the shell's own state,
 * because what has to be claimed is where the element *landed*: a box the
 * shell asked for is not one the page necessarily laid out, and the
 * compositor's hit-test is against the screen. The same reason a portal is
 * measured rather than declared.
 *
 * @param measure - How to read an element's placement. The SDK's own, which is
 *   what puts a claim in the same space — and the same units — as the windows
 *   it is tested against.
 */
export const claimedRegions = (measure: Measure): PointerRegion[] =>
  [...document.querySelectorAll<HTMLElement>(`[${CLAIMS_POINTER}]`)].map(
    (element) => {
      const { size, transform, zIndex } = measure(element);
      return { size, transform, zIndex };
    },
  );
