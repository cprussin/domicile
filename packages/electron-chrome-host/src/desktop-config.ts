// The part of a shell's configuration that the compositor is the one to act on.
//
// A shell owns its config file — its schema, its location, its name for
// everything — but the desktop's shape is Domicile's business, and every shell
// would otherwise reimplement the same validation. So this is the section a
// shell can embed in its own schema and hand over whole.

import { z } from "zod";

import type { CompositorConfig } from "./compositor-config";

/**
 * An x and a y, in whatever space a shell lays displays out in.
 *
 * Signed: "to the left of that one" is the obvious way to describe a second
 * monitor, and the compositor normalises the layout into the desktop's own
 * space afterwards.
 */
const position = z.tuple([z.number().int(), z.number().int()]);

/**
 * A width and a height.
 *
 * Not the same shape as a position, which is the whole point: the compositor
 * takes an extent as an unsigned pair and then rejects zero, so a shared
 * schema let `[0, -1080]` through to be refused three processes later, in a
 * message about a file the user never wrote.
 */
const extent = z.tuple([
  z.number().int().positive(),
  z.number().int().positive(),
]);

const desktop = z
  .object({
    displays: z
      .array(
        z
          .object({
            name: z.string().min(1),
            position: position.optional(),
            scale: z.number().int().positive().optional(),
            size: extent,
          })
          .strict(),
      )
      .optional(),
    keyboard: z
      .object({
        layout: z.string().optional(),
        model: z.string().optional(),
        options: z.array(z.string()).optional(),
        rules: z.string().optional(),
        variant: z.string().optional(),
      })
      .strict()
      .optional(),
    maxScale: z.number().int().positive().optional(),
    nestedSize: extent.optional(),
  })
  .strict();

/**
 * Read the desktop out of a shell's own configuration.
 *
 * Throws on anything the compositor would refuse — which it would, three
 * processes later, in a message about a file the user never wrote. Unknown keys
 * are refused for the same reason: a setting that silently does nothing is
 * worse than a refusal naming it.
 */
export const parseDesktop = (value: unknown): CompositorConfig =>
  value === undefined ? {} : desktop.parse(value);
