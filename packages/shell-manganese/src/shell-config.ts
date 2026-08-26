// This shell's configuration: the file its users write.
//
// The shell owns this, not Domicile. Someone running the manganese shell runs
// `manganese`, and configures it here — there is no compositor to know about and
// nothing of Domicile's to configure directly. What the compositor needs is
// derived from this and handed over when it is started.

import path from "node:path";
import type { CompositorConfig } from "@domicile/electron-chrome-host/compositor-config";
import { parseDesktop } from "@domicile/electron-chrome-host/desktop-config";
import { z } from "zod";

/** Where this shell keeps its configuration, under `$XDG_CONFIG_HOME`. */
const RELATIVE = path.join("domicile", "manganese.json");

/** The environment as a process has it, which is all-optional by nature. */
type Environment = Readonly<Record<string, string | undefined>>;

/** Everything the manganese shell can be told. */
export type ShellConfig = {
  /**
   * Whether the desktop is on a screen.
   *
   * True is what running a shell means: a user typed its name. False is the
   * headless arrangement this repo's checks drive, where client frames arrive
   * as pixels for the page to draw into a canvas.
   */
  present: boolean;
  /** The desktop's shape — the part the compositor acts on. */
  desktop: CompositorConfig;
};

/**
 * Where this shell's config file lives, for the environment it is run in.
 *
 * `$XDG_CONFIG_HOME`, then the default XDG spells out. No fallback past that:
 * a process with neither is not a user session, and answering "the working
 * directory" for it would read a config out of wherever the shell happened to
 * be started from.
 */
export const configPath = ({ HOME, XDG_CONFIG_HOME }: Environment): string => {
  if (XDG_CONFIG_HOME !== undefined) {
    return path.join(XDG_CONFIG_HOME, RELATIVE);
  } else if (HOME === undefined) {
    throw new Error(
      "manganese: neither $XDG_CONFIG_HOME nor $HOME is set, so there is nowhere to read a config from",
    );
  } else {
    return path.join(HOME, ".config", RELATIVE);
  }
};

/**
 * Read this shell's configuration.
 *
 * Throws on anything it cannot read: a desktop that came up wearing defaults
 * looks like the settings did not take, rather than like the file is broken.
 */
export const parseShellConfig = (text: string): ShellConfig => {
  const written = shellConfig.parse(JSON.parse(text));
  return { desktop: parseDesktop(written.desktop), present: written.present };
};

/**
 * This shell's own half of the file. `desktop` is left as-is here and handed
 * to `parseDesktop`, which owns that section's schema.
 */
const shellConfig = z
  .object({
    desktop: z.optional(z.unknown()),
    present: z.boolean().default(true),
  })
  .strict();
