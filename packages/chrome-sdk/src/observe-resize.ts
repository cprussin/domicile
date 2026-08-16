// Watching an `<domicile-app>`'s laid-out box.
//
// A portal is only correct for as long as its element stays where the chrome
// last measured it: CSS animations, window resizes and layout changes all move
// it without any code running. Observing the box is what keeps the host's copy
// of the geometry — and the client's own render resolution — in step.

/** Start watching `element`; returns the function that stops watching. */
export type ObserveResize = (
  element: HTMLElement,
  onResize: () => void,
) => () => void;

export const defaultObserveResize: ObserveResize = (element, onResize) => {
  const observer = new ResizeObserver(() => {
    onResize();
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};
