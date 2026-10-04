/**
 * Returns the wrapper element around a control under test.
 *
 * Throws instead of returning `null` so tests don't repeat the guard.
 */
export const wrapperOf = (control: HTMLElement): HTMLElement => {
  const wrapper = control.parentElement;
  if (wrapper === null) {
    throw new Error("expected control to have a wrapper element");
  } else {
    return wrapper;
  }
};
