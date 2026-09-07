// Reading a number out of the environment, which is external data and gets
// parsed like any other.
//
// Not cosmetic, and the bug that put this here says why. `DOMICILE_REACH_MS`
// was read with a bare `Number()`. `Number("soon")` is `NaN`, `now() + NaN >=
// until` is never true, and the bridge's retry loop then runs until the
// process dies — a page whose transport never opens and never closes, with
// nothing said. That is the exact failure the setting was added to prevent.
//
// `Number()` is too generous in the other direction as well: `""` and `"  "`
// are `0`, `"1e3"` is `1000`, `"0x10"` is `16`. A launcher that wrote any of
// those meant something by it, and a budget of zero milliseconds is as wrong
// as one of `NaN`.

import { z } from "zod";

/**
 * A run of decimal digits, and nothing else — not a sign, not an exponent, not
 * a radix prefix, not the empty string. `Number` is applied only once the
 * shape is known, so none of its coercions can get in.
 */
const wholeNumber = z
  .string()
  .regex(/^\d+$/)
  .transform((digits) => Number(digits));

/**
 * `raw` as a whole number, or `undefined` if it was not set.
 *
 * Refuses rather than defaulting, and says which variable and what it read: a
 * launcher that passed something meaningless meant something by it, and
 * quietly running with a different number is how a program ends up measuring a
 * configuration nobody chose.
 */
export const wholeNumberFromEnv = (
  name: string,
  raw: string | undefined,
  onRefusal: (message: string) => never,
): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = wholeNumber.safeParse(raw);
  if (!parsed.success) {
    return onRefusal(
      `domicile: ${name} must be a whole number, not ${JSON.stringify(raw)}`,
    );
  }
  return parsed.data;
};
