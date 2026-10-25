// A readable name for an application known only by its id.

/**
 * `id` as a person reads it: the last part of a reverse-DNS id, capitalized,
 * with `-` and `_` as spaces. `com.chromium.Chromium` is `Chromium`.
 */
export const appIdName = (id: string): string => {
  const words = (id.split(".").at(-1) ?? id).replaceAll(/[-_]/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};
