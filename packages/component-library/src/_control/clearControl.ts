/**
 * Clears an input or textarea and fires React's `onChange`.
 *
 * Uses the prototype `value` setter because React ignores the input event
 * after a direct `control.value = ""` assignment.
 */
export const clearControl = <E extends HTMLInputElement | HTMLTextAreaElement>(
  control: E,
) => {
  const proto = Object.getPrototypeOf(control) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter !== undefined) {
    setter.call(control, "");
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // The clear button took focus; return it so the user can keep typing.
  control.focus();
};
