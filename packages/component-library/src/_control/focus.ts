import type { MouseEventHandler } from "react";

export const focusControlOnMouseDown: MouseEventHandler<HTMLElement> = (
  event,
) => {
  if (event.target === event.currentTarget) {
    event.preventDefault();
    focusControl(event.currentTarget);
  }
};

export const keepControlFocusedOnMouseDown: MouseEventHandler<HTMLElement> = (
  event,
) => {
  event.preventDefault();
  if (event.target === event.currentTarget) {
    focusControl(event.currentTarget);
  }
};

const focusControl = (root: HTMLElement) => {
  // The parentElement fallback is load-bearing for `TrailingGroup`, which
  // attaches `keepControlFocusedOnMouseDown` to a sibling of the control
  // (not an ancestor). Searching from the trailing-group span itself never
  // finds the input; searching its parent (the wrapper div) does.
  const control =
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "[data-control]",
    ) ??
    root.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "[data-control]",
    );
  control?.focus();
};
