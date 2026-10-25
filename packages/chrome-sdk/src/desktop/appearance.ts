// The config's `theme` keys besides `mode`: the accent color, contrast and
// reduced motion the settings portal also serves applications. A shell follows
// them so the desk matches its windows. See `docs/SHELL-CONFIG.md`.

import { z } from "zod";

import type { DomicileHost } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/** How the config asks the desktop to look, beside its theme. */
export type Appearance = {
  /** `#rrggbb`, or `undefined` to keep the shell's own accent. */
  readonly accentColor: string | undefined;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
};

export type AppearanceListeners = {
  change: () => void;
};

/** Each read throws on an accent that is not `#rrggbb`. */
export type AppearanceNamespace = Appearance & {
  on: On<AppearanceListeners>;
};

export type AppearanceHost = Pick<
  DomicileHost,
  | "accentColor"
  | "addEventListener"
  | "highContrast"
  | "reducedMotion"
  | "removeEventListener"
>;

export const appearance = (host: AppearanceHost): AppearanceNamespace => ({
  get accentColor() {
    return readAppearance(host).accentColor;
  },
  get highContrast() {
    return readAppearance(host).highContrast;
  },
  on: on<AppearanceListeners>({
    change: (listener) =>
      hostEvent(host, "appearancechanged", () => listener()),
  }),
  get reducedMotion() {
    return readAppearance(host).reducedMotion;
  },
});

/** The appearance `host` says now. Throws on an accent that is not `#rrggbb`. */
export const readAppearance = (
  host: Pick<DomicileHost, "accentColor" | "highContrast" | "reducedMotion">,
): Appearance => appearanceSchema.parse(host);

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
    (read): Appearance => ({
      accentColor: read.accentColor ?? undefined,
      highContrast: read.highContrast ?? false,
      reducedMotion: read.reducedMotion ?? false,
    }),
  );
