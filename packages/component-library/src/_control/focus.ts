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
  // `TrailingGroup` is a sibling of the control, so search its parent too.
  const control =
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "[data-control]",
    ) ??
    root.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "[data-control]",
    );
  control?.focus();
};
