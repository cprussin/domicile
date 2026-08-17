/**
 * Programmatically clears an input or textarea. Writes through the prototype
 * `value` setter (rather than assigning `control.value = ""` directly) so
 * React's synthetic-event tracker observes the change and fires `onChange`.
 * Without this dance, React skips the change event because its bookkeeping
 * still thinks the value matches the last-rendered value.
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
  // Clicking the clear button moved focus from the input to the button;
  // restore focus so the user can keep typing immediately.
  control.focus();
};
