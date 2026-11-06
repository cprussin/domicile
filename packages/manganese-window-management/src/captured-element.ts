// Test-only.

/**
 * An element that tracks the pointer it captured, as a pressed border does.
 * happy-dom does not track capture.
 */
export const capturingElement = (): HTMLElement => {
  const element = document.createElement("div");
  let captured = false;
  element.setPointerCapture = () => {
    captured = true;
  };
  element.hasPointerCapture = () => captured;
  element.releasePointerCapture = () => {
    captured = false;
  };
  return element;
};
