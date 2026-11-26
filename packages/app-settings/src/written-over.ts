// Writing a config that has temporary changes over it.
// See docs/SETTINGS.md#temporary-changes.

import type { ConfigDocument, ConfigPath } from "./config-document";
import { serialize, valueAt, withValue } from "./config-document";
import type { ConfigOverride } from "./host";
import { changesUnder, withOverrides } from "./temporary-changes";

/**
 * The file with `value` written at `path` of a writable config shown with
 * `overrides` over it, and the changes the write ends.
 *
 * - A change under `path` the write left as shown is the shell's or the
 *   tray's, and stays: the file keeps its own value there, as a whole section
 *   written from the shown view would otherwise make it the file's for good.
 * - One under `path` the write changed, or whose list it moved, ends: the
 *   file has what the page wrote there.
 * - One at or above `path` ends once the file has the value, which the
 *   compositor sees itself when the write changed the file's value at its
 *   path. One the write left alike would stay, so it ends here.
 */
export const writtenOver = (
  document: ConfigDocument,
  overrides: readonly ConfigOverride[],
  path: ConfigPath,
  value: unknown,
): { ended: ConfigPath[]; text: string } => {
  const shown = withOverrides(document, overrides);
  const next = withValue(document, path, value);
  const under = changesUnder(overrides, [path]).filter(
    (change) => change.path.length > path.length,
  );
  // Each list between `path` and the change as long as it was shown, so
  // its index still names the item it did.
  const sameItems = (change: ConfigOverride) =>
    change.path.every((key, at) => {
      if (at < path.length || typeof key !== "number") {
        return true;
      }
      const list = valueAt(next, change.path.slice(0, at));
      const was = valueAt(shown, change.path.slice(0, at));
      return (
        Array.isArray(list) && Array.isArray(was) && list.length === was.length
      );
    });
  const kept = under.filter(
    (change) =>
      sameItems(change) &&
      sameJson(
        valueAt(next, change.path),
        change.value === null ? undefined : change.value,
      ),
  );
  const written = kept.reduce(
    (changed, change) =>
      withValue(
        changed,
        change.path,
        change.written === null ? undefined : change.written,
      ),
    next,
  );
  const above = overrides.filter(
    (change) =>
      change.path.length <= path.length &&
      change.path.every((key, at) => path[at] === key) &&
      sameJson(valueAt(written, change.path), valueAt(document, change.path)),
  );
  const ended = [
    ...under.filter((change) => !kept.includes(change)),
    ...above,
  ].map((change) => change.path);
  return { ended, text: serialize(written) };
};

/** Whether `a` and `b` are the same JSON, whatever order their keys are in. */
const sameJson = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((each, at) => sameJson(each, b[at]))
    );
  } else if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameJson(a[key], b[key]))
    );
  } else {
    return a === b;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
