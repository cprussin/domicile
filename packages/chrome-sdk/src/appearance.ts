// The config's `theme` keys besides `mode`: the accent color, contrast and
// reduced motion the settings portal also serves applications. A shell follows
// them so the desk matches its windows. See `docs/SHELL-CONFIG.md`.

import { z } from "zod";

import type { DomicileHost } from "./domicile-host";

/** How the config asks the desktop to look, beside its theme. */
export type Appearance = {
  /** `#rrggbb`, or `undefined` to keep the shell's own accent. */
  readonly accentColor: string | undefined;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
};

/** What `watchAppearance` needs of the desktop `Shell` is handed. */
export type AppearanceHost = Pick<
  DomicileHost,
  | "accentColor"
  | "addEventListener"
  | "highContrast"
  | "reducedMotion"
  | "removeEventListener"
>;

/**
 * Call `listener` with the appearance now and on each change. Returns a
 * function that stops listening. Throws on an accent that is not `#rrggbb`.
 */
export const watchAppearance = (
  host: AppearanceHost,
  listener: (appearance: Appearance) => void,
): (() => void) => {
  const heard = () => {
    listener(appearanceSchema.parse(host));
  };
  host.addEventListener("appearancechanged", heard);
  heard();
  return () => {
    host.removeEventListener("appearancechanged", heard);
  };
};

// Each attribute is `null` until the compositor says, which reads as the
// config's default.
const appearanceSchema = z
  .object({
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    highContrast: z.boolean().nullable(),
    reducedMotion: z.boolean().nullable(),
  })
  .transform(
    (appearance): Appearance => ({
      accentColor: appearance.accentColor ?? undefined,
      highContrast: appearance.highContrast ?? false,
      reducedMotion: appearance.reducedMotion ?? false,
    }),
  );
