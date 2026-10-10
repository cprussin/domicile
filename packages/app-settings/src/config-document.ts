// A JSON config as the file holds it. Edits change one value and keep every
// other key, including ones this app does not know.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";

/** A config file's top-level object. */
export type ConfigDocument = Readonly<Record<string, unknown>>;

/** The keys, and array indexes, from the top of a config down to one value. */
export type ConfigPath = readonly (string | number)[];

/** Reads a config file's text, or says why it is not a config. */
export const parseDocument = (text: string): Result<ConfigDocument, string> => {
  const json = parseJson(text);
  return json.andThen(({ value }) => {
    const document = objectSchema.safeParse(value);
    return document.success
      ? Ok(document.data)
      : Err("A config is a JSON object");
  });
};

/** The value at `path`, or `undefined` where the config has none. */
export const valueAt = (document: ConfigDocument, path: ConfigPath): unknown =>
  path.reduce<unknown>((at, key) => {
    if (typeof key === "number") {
      return Array.isArray(at) ? at[key] : undefined;
    } else {
      return isObject(at) ? at[key] : undefined;
    }
  }, document);

/**
 * A copy of `document` with `value` at `path`. `undefined` removes the key or
 * array item, and a section it leaves empty, so a value set back to its
 * default leaves no trace.
 */
export const withValue = (
  document: ConfigDocument,
  path: ConfigPath,
  value: unknown,
): ConfigDocument => {
  const [key, ...rest] = path;
  if (typeof key === "string") {
    return objectWith(document, key, rest, value);
  } else {
    throw new Error("A config path starts at a section");
  }
};

/** The file's text for `document`. */
export const serialize = (document: ConfigDocument): string =>
  `${JSON.stringify(document, undefined, 2)}\n`;

const objectSchema = z.record(z.string(), z.unknown());

/** The JSON `text` holds, boxed since it may be `null`. */
const parseJson = (text: string): Result<{ value: unknown }, string> => {
  try {
    return Ok({ value: JSON.parse(text) });
  } catch (error) {
    return Err(error instanceof Error ? error.message : String(error));
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `container` with `value` at `[key, ...rest]`. */
const at = (container: unknown, path: ConfigPath, value: unknown): unknown => {
  const [key, ...rest] = path;
  switch (typeof key) {
    case "undefined":
      return value;
    case "number":
      return arrayWith(
        Array.isArray(container) ? container : [],
        key,
        rest,
        value,
      );
    case "string":
      return objectWith(isObject(container) ? container : {}, key, rest, value);
  }
};

const objectWith = (
  object: ConfigDocument,
  key: string,
  rest: ConfigPath,
  value: unknown,
): ConfigDocument => {
  const next = at(object[key], rest, value);
  const { [key]: _old, ...others } = object;
  return next === undefined || isEmptySection(next, rest)
    ? others
    : { ...others, [key]: next };
};

const arrayWith = (
  array: readonly unknown[],
  index: number,
  rest: ConfigPath,
  value: unknown,
): unknown[] => {
  const next = at(array[index], rest, value);
  return next === undefined
    ? array.toSpliced(index, 1)
    : array.toSpliced(index, 1, next);
};

/** Whether `value` is a section that a removal emptied. */
const isEmptySection = (value: unknown, rest: ConfigPath) =>
  rest.length > 0 && isObject(value) && Object.keys(value).length === 0;
