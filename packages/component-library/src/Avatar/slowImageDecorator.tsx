import type { Decorator } from "@storybook/react-vite";
import { useEffect, useState } from "react";

/**
 * Storybook decorator that monkey-patches `window.Image` so the next image
 * created while a story is mounted defers its load callback by 5 seconds.
 * Lets the Avatar stories show the loading skeleton long enough to inspect
 * before the image fades in (or fails). Reverts the patch on unmount.
 *
 * The patch is installed during render (via `useState` lazy init) rather
 * than from `useEffect`, because base-ui's `useImageLoadingStatus` calls
 * `new window.Image()` from inside `useIsoLayoutEffect` — a *layout* effect
 * that fires before our decorator's passive `useEffect`. Installing the
 * patch later would miss the probe Image's construction and the loading
 * delay would never apply. Uninstall still runs from `useEffect` cleanup,
 * which is fine because the patch only needs to be removed on unmount.
 */
export const slowImageDecorator: Decorator = (Story) => {
  useState(installSlowImage);
  useEffect(() => uninstallSlowImage, []);
  return <Story />;
};

const SLOW_LOAD_MS = 5000;
const PATCH_FLAG = "__avatarSlowImageOriginal";

type PatchedWindow = typeof window & { [PATCH_FLAG]?: typeof window.Image };

const installSlowImage = () => {
  if (typeof window === "undefined") {
    return;
  } else {
    const w = window as PatchedWindow;
    if (w[PATCH_FLAG] === undefined) {
      const OriginalImage = window.Image;
      const srcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        "src",
      );
      const completeDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        "complete",
      );
      if (srcDescriptor === undefined || completeDescriptor === undefined) {
        return;
      } else {
        // Must be a `function` (not arrow) because consumers call
        // `new window.Image(...)` and arrow functions are not constructable.
        const SlowImage = function (
          ...args: ConstructorParameters<typeof OriginalImage>
        ) {
          const img = new OriginalImage(...args);
          let pending = false;
          Object.defineProperty(img, "complete", {
            configurable: true,
            get: () =>
              pending === true ? false : completeDescriptor.get?.call(img),
          });
          Object.defineProperty(img, "src", {
            configurable: true,
            get: () => srcDescriptor.get?.call(img),
            set: (value: string) => {
              pending = true;
              window.setTimeout(() => {
                pending = false;
                srcDescriptor.set?.call(img, value);
              }, SLOW_LOAD_MS);
            },
          });
          return img;
        } as unknown as typeof window.Image;
        w[PATCH_FLAG] = OriginalImage;
        window.Image = SlowImage;
      }
    } else {
      return;
    }
  }
};

const uninstallSlowImage = () => {
  if (typeof window === "undefined") {
    return;
  } else {
    const w = window as PatchedWindow;
    const original = w[PATCH_FLAG];
    if (original !== undefined) {
      window.Image = original;
      delete w[PATCH_FLAG];
    }
  }
};
