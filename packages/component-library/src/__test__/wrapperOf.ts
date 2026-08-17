/**
 * Returns the parent element of a control under test. Throws (rather than
 * returning `null`) so tests don't need to repeat the `if (wrapper === null)
 * throw …` guard at every call site. Use this when asserting on styles or
 * attributes the component sets on the wrapper div around a control element.
 */
export const wrapperOf = (control: HTMLElement): HTMLElement => {
  const wrapper = control.parentElement;
  if (wrapper === null) {
    throw new Error("expected control to have a wrapper element");
  } else {
    return wrapper;
  }
};
