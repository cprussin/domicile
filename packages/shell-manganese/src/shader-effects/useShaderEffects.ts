// The shell's shader effects: registered once, and named on `<html>` while
// they may draw, where each motion's CSS looks for them. See
// docs/architecture/MOTION.md.

import type {
  Effects,
  ShaderEffect,
} from "@domicile-desktop/sdk/desktop/effects";
import { useEffect, useLayoutEffect, useState } from "react";

/** Whether the person wants shader effects. */
type Wanted = {
  /** Motion is reduced, which turns every effect off. */
  readonly reducedMotion: boolean;
  /** The Settings switch for them. */
  readonly switchedOn: boolean;
};

/**
 * Registers `programs` by name, once, and lists on `root`'s
 * `data-shader-effects` those that compiled and still draw, while they are
 * `wanted`. With them it sets `root`'s `--device-pixel-ratio` to
 * `pixelRatio`, which each effect's CSS passes so it measures in CSS pixels.
 *
 * A motion's CSS applies an effect only when its name is listed, so a motion
 * whose effect is off, refused or lost plays without it. An effect the GPU
 * lost is not registered again: it may have hung the GPU, and would again.
 */
export const useShaderEffects = (
  effects: Effects,
  programs: Readonly<Record<string, ShaderEffect>>,
  { reducedMotion, switchedOn }: Wanted,
  pixelRatio: number,
  root: HTMLElement = document.documentElement,
): void => {
  const [ready, setReady] = useState<readonly string[]>(NONE);
  useEffect(() => {
    for (const [name, program] of Object.entries(programs)) {
      effects
        .register(name, program)
        .then((compiled) => {
          compiled.match({
            Err: (why) => {
              // biome-ignore lint/suspicious/noConsole: the motion plays without its effect, which nothing else shows
              console.error(
                `shell: shader effect ${name} did not compile; its motions play without it: ${why}`,
              );
            },
            Ok: () => {
              setReady((was) => [...was, name]);
            },
          });
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: the motion plays without its effect, which nothing else shows
          console.error(`shell: cannot register shader effect ${name}`, error);
        });
    }
    return effects.on("lost", (name) => {
      // biome-ignore lint/suspicious/noConsole: the motion plays without its effect, which nothing else shows
      console.error(
        `shell: the GPU dropped shader effect ${name}; its motions play without it`,
      );
      setReady((was) => was.filter((kept) => kept !== name));
    });
  }, [effects, programs]);
  useLayoutEffect(() => {
    if (switchedOn && !reducedMotion && ready.length > 0) {
      root.setAttribute("data-shader-effects", ready.toSorted().join(" "));
      root.style.setProperty("--device-pixel-ratio", pixelRatio.toString());
    } else {
      root.removeAttribute("data-shader-effects");
      root.style.removeProperty("--device-pixel-ratio");
    }
  }, [pixelRatio, reducedMotion, ready, root, switchedOn]);
};

const NONE: readonly string[] = [];
