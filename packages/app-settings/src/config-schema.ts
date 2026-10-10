// The config's sections as the form shows them: the `domicile-config` crate's
// schema in Zod, with its defaults. The crate is the source of truth. The host
// checks every write against it, so this schema only has to read.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";

import type { ConfigDocument } from "./config-document";

/** The default for `files.omit`: hidden paths. */
export const DEFAULT_OMIT = ["**/.*"];

/** `theme.mode`'s values. */
export const THEME_MODES = ["dark", "light"] as const;

/** `theme.contrast`'s values. */
export const CONTRASTS = ["normal", "high"] as const;

/** A profile display's `transform` values. */
export const TRANSFORMS = [
  "normal",
  "rotate-90",
  "rotate-180",
  "rotate-270",
] as const;

/** The `lockdown` switches. */
export const LOCKDOWN_SWITCHES = [
  "disable_printing",
  "disable_save_to_disk",
  "disable_application_handlers",
  "disable_location",
  "disable_camera",
  "disable_microphone",
  "disable_sound_output",
] as const;

const point = z.tuple([z.number().int(), z.number().int()]);
const size = z.tuple([
  z.number().int().positive(),
  z.number().int().positive(),
]);

const displaySchema = z.strictObject({
  name: z.string(),
  position: point.default([0, 0]),
  scale: z.number().int().positive().default(1),
  size,
});

const placementSchema = z.strictObject({
  display: z.string(),
  enabled: z.boolean().default(true),
  mode: size.optional(),
  position: point.default([0, 0]),
  scale: z.number().positive().default(1),
  transform: z.enum(TRANSFORMS).default("normal"),
});

const profileSchema = z.strictObject({
  displays: z.array(placementSchema),
  name: z.string(),
});

const settingsSchema = z.strictObject({
  extensions: z
    .strictObject({
      unpacked: z.array(z.string()).default([]),
      web_store: z.array(z.string()).default([]),
    })
    .prefault({}),
  files: z
    .strictObject({ omit: z.array(z.string()).default(DEFAULT_OMIT) })
    .prefault({}),
  idle: z
    .strictObject({
      blank_after_seconds: z.number().int().positive().optional(),
    })
    .prefault({}),
  input: z
    .strictObject({
      keyboard: z
        .strictObject({
          xkb_layout: z.string().default("us"),
          xkb_model: z.string().default(""),
          xkb_options: z.array(z.string()).default([]),
          xkb_rules: z.string().default(""),
          xkb_variant: z.string().default(""),
        })
        .prefault({}),
    })
    .prefault({}),
  lock: z
    .strictObject({
      pam_service: z.string().optional(),
      passphrase: z.string().optional(),
    })
    .prefault({}),
  lockdown: z
    .strictObject({
      disable_application_handlers: z.boolean().default(false),
      disable_camera: z.boolean().default(false),
      disable_location: z.boolean().default(false),
      disable_microphone: z.boolean().default(false),
      disable_printing: z.boolean().default(false),
      disable_save_to_disk: z.boolean().default(false),
      disable_sound_output: z.boolean().default(false),
    })
    .prefault({}),
  output: z
    .strictObject({
      displays: z.array(displaySchema).default([]),
      max_scale: z.number().int().positive().default(2),
      profiles: z.array(profileSchema).default([]),
    })
    .prefault({}),
  shell: z.string().optional(),
  startup: z
    .strictObject({ commands: z.array(z.array(z.string())).default([]) })
    .prefault({}),
  theme: z
    .strictObject({
      accent_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      contrast: z.enum(CONTRASTS).default("normal"),
      icon_theme: z.string().optional(),
      mode: z.enum(THEME_MODES).default("dark"),
      reduced_motion: z.boolean().default(false),
    })
    .prefault({}),
});

/** Every setting, with the compositor's defaults filled in. */
export type Settings = z.infer<typeof settingsSchema>;

/** A profile, which arranges the monitors that are plugged in. */
export type Profile = z.infer<typeof profileSchema>;

/** A display a profile places. */
export type Placement = z.infer<typeof placementSchema>;

/** A display described outright. */
export type Display = z.infer<typeof displaySchema>;

/** Reads `document`'s settings, or says where it does not fit the schema. */
export const readSettings = (
  document: ConfigDocument,
): Result<Settings, string> => {
  const read = settingsSchema.safeParse(document);
  return read.success ? Ok(read.data) : Err(z.prettifyError(read.error));
};
