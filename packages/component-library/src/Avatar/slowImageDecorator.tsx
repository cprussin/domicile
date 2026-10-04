import type { Decorator } from "@storybook/react-vite";
import { useEffect, useState } from "react";

/**
 * Storybook decorator that delays image loads by 5 seconds, so Avatar stories
 * show the loading skeleton.
 *
 * Patches `window.Image` during render, not in `useEffect`: base-ui creates
 * its probe image in a layout effect, which runs before this decorator's
 * effects.
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
        // A `function`, since callers use `new` and arrows can't construct.
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
