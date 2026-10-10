// A number typed into a text field, checked as the config's schema checks it.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

/** What a field's number must be. */
export type NumberRule = { integer: boolean; positive: boolean };

/** The number `text` holds, or why it is not one the field takes. */
export const parseNumber = (
  text: string,
  { integer, positive }: NumberRule,
): Result<number, string> => {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(value)) {
    return Err(trimmed === "" ? "Type a number" : `${trimmed} is not a number`);
  } else if (integer && !Number.isInteger(value)) {
    return Err(`${trimmed} is not a whole number`);
  } else if (positive && value <= 0) {
    return Err(`${trimmed} is not more than 0`);
  } else {
    return Ok(value);
  }
};
