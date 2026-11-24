/** A box on the page, as `getBoundingClientRect` gives it. */
export type Box = {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
};

/**
 * How far a popup moves to put its middle on its origin's: where a popup that
 * springs from the origin starts and ends.
 */
export const originOffset = (
  popup: Box,
  origin: Box,
): { readonly x: number; readonly y: number } => ({
  x: middle(origin.left, origin.width) - middle(popup.left, popup.width),
  y: middle(origin.top, origin.height) - middle(popup.top, popup.height),
});

const middle = (start: number, size: number): number => start + size / 2;
