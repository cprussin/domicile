// The `floating` option: which client windows open floating, as sway's
// `for_window [app_id=…] floating enable`. Dialogs float without a rule.

import type { DomicileWindow } from "@domicile-desktop/sdk/domicile-host";
import { z } from "zod";

/** A pattern as the config writes it, compiled when the config is built. */
const patternSchema = z
  .string()
  .transform((source) => new RegExp(source, "u"))
  .optional();

/** Parses `runManganese`'s `floating`: rules, each matching all it names. */
export const floatingRulesSchema = z
  .array(
    z
      .strictObject({
        /** Matches the client's Wayland app id. */
        app: patternSchema,
        /** Matches the window's title when it first draws. */
        title: patternSchema,
      })
      .refine(
        ({ app, title }) => app !== undefined || title !== undefined,
        "a floating rule names an app, a title or both",
      ),
  )
  .readonly()
  .default([]);

export type FloatingRules = z.output<typeof floatingRulesSchema>;

/** The option as written. */
export type FloatingOptions = z.input<typeof floatingRulesSchema>;

/** Whether `window` opens floating: it is a dialog, or a rule names it. */
export const opensFloating = (
  rules: FloatingRules,
  window: DomicileWindow,
): boolean =>
  window.dialog ||
  rules.some(
    ({ app, title }) =>
      (app === undefined || app.test(window.desktopId)) &&
      (title === undefined || title.test(window.title)),
  );
