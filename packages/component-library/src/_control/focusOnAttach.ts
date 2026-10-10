/**
 * A callback ref that focuses its element as it mounts. React passes `null`
 * on detach, which needs nothing.
 */
export const focusOnAttach = (element: HTMLElement | null) => {
  if (element !== null) {
    element.focus();
  }
};
