// The `wallpapers` option: each theme's photographs, by web address or path.

import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { z } from "zod";

import { DEFAULT_WALLPAPERS } from "./photos";

/** Whether `photo` is a web address, not a path. */
export const isWebAddress = (photo: string): boolean =>
  /^https?:\/\/./i.test(photo);

/**
 * One theme's photographs, in order: web addresses, and paths to images or
 * folders of them. At least one.
 */
const photosSchema = z
  .array(
    z
      .string()
      .refine(
        (photo) => isWebAddress(photo) || /^~?\//.test(photo),
        "a wallpaper must be an http or https URL, or a path starting with / or ~/",
      ),
  )
  .min(1, "a theme's wallpapers need at least one photograph")
  .readonly();

/**
 * Parses `runManganese`'s `wallpapers`. A theme left out keeps the built-in
 * photographs. See `docs/WALLPAPER.md`.
 */
export const wallpapersSchema = z
  .strictObject({
    dark: photosSchema.default(DEFAULT_WALLPAPERS.dark),
    light: photosSchema.default(DEFAULT_WALLPAPERS.light),
  })
  .default(DEFAULT_WALLPAPERS);

/** Each theme's photographs, which the desktop shows shuffled. */
export type Wallpapers = Readonly<Record<Theme, readonly string[]>>;

/** The option as written, before defaults. */
export type WallpapersOptions = z.input<typeof wallpapersSchema>;
