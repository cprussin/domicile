/**
 * The transform `popup` starts from below and above its anchor, with base-ui's
 * starting attribute set. Throws unless it also starts transparent.
 */
export const startsAt = (
  popup: HTMLElement,
): { readonly bottom: string; readonly top: string } => {
  popup.setAttribute("data-starting-style", "");
  return { bottom: startOn(popup, "bottom"), top: startOn(popup, "top") };
};

/** The transform `popup` starts from on `side` of its anchor. */
const startOn = (popup: HTMLElement, side: string): string => {
  popup.setAttribute("data-side", side);
  const { opacity, transform } = globalThis.getComputedStyle(popup);
  if (opacity === "0") {
    return transform;
  } else {
    throw new Error(`starts at opacity ${opacity} on the ${side}`);
  }
};
