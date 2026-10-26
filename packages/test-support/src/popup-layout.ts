// Fakes the layout base-ui's positioner reads, so tests can check where a
// popup lands. happy-dom lays nothing out: every box is empty.

import { screen } from "@testing-library/react";

/** A box in page pixels. */
export type Box = { height: number; width: number; x: number; y: number };

/**
 * Lays `element` out at `box`, as a browser would. Sets its client size too,
 * which the positioner reads for an element it must stay inside.
 */
export const drawAt = (element: Element, box: Box): void => {
  element.getBoundingClientRect = () => DOMRect.fromRect(box);
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: box.height },
    clientWidth: { configurable: true, value: box.width },
  });
};

const unpatched = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
// Defined on `Element`, so the override on `HTMLElement` shadows it.
const elementRect = Element.prototype.getBoundingClientRect;

/**
 * Lays every popup with ARIA role `role` out at `size`, in a 1920px-wide
 * page. The positioner measures the element around the popup. Undo it with
 * {@link undrawPopups}.
 */
export const drawPopups = (
  role: string,
  size: { height: number; width: number },
): void => {
  const isPopup = (element: HTMLElement) =>
    element.querySelector(`:scope > [role=${role}]`) !== null;
  Object.defineProperties(document.documentElement, {
    clientHeight: { configurable: true, value: 1080 },
    clientWidth: { configurable: true, value: 1920 },
  });
  Object.defineProperties(HTMLElement.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        return isPopup(this)
          ? DOMRect.fromRect({ ...size, x: 0, y: 0 })
          : elementRect.call(this);
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isPopup(this) ? size.height : 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return isPopup(this) ? size.width : 0;
      },
    },
  });
};

export const undrawPopups = (): void => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).getBoundingClientRect;
  Object.defineProperties(HTMLElement.prototype, unpatched);
  Reflect.deleteProperty(document.documentElement, "clientHeight");
  Reflect.deleteProperty(document.documentElement, "clientWidth");
};

/** The open popup with ARIA role `role`'s left edge, from its positioner. */
export const popupLeft = (role: string): number => {
  const transform = screen.getByRole(role).parentElement?.style.transform ?? "";
  const x = /translate\((-?[\d.]+)px/.exec(transform)?.[1];
  if (x === undefined) {
    throw new Error(`the ${role} is not placed: "${transform}"`);
  } else {
    return Number(x);
  }
};
