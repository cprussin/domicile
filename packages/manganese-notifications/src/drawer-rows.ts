import type { Notification } from "@domicile-desktop/sdk/notification";

/** A notification drawn in the drawer. */
export type Row = {
  notification: Notification;
  /**
   * While it animates out, its place among the rows cleared with it, top to
   * bottom, which staggers them.
   */
  leaving: number | undefined;
};

/**
 * The rows to draw for `items`, given the rows drawn before.
 *
 * A notification gone from `items` stays under the row above it, leaving, until
 * its animation ends. One back in `items` stays. Without `animate`, such as
 * while the drawer is closed, gone notifications go at once.
 */
export const nextRows = (
  rows: readonly Row[],
  items: readonly Notification[],
  animate: boolean,
): Row[] => {
  const kept = new Set(items.map(({ id }) => id));
  const gone = animate
    ? rows.filter(({ notification }) => !kept.has(notification.id))
    : [];
  const starting = gone.filter(({ leaving }) => leaving === undefined);
  const under = leavingUnder(rows, kept, gone, starting);
  return [
    ...(under.get(undefined) ?? []),
    ...items.flatMap((notification) => [
      { leaving: undefined, notification },
      ...(under.get(notification.id) ?? []),
    ]),
  ];
};

/**
 * The leaving rows by the id of the staying row above each, `undefined` for
 * those above every staying row.
 */
const leavingUnder = (
  rows: readonly Row[],
  kept: ReadonlySet<number>,
  gone: readonly Row[],
  starting: readonly Row[],
): Map<number | undefined, Row[]> => {
  const under = new Map<number | undefined, Row[]>();
  let above: number | undefined;
  for (const row of rows) {
    if (kept.has(row.notification.id)) {
      above = row.notification.id;
    } else if (gone.includes(row)) {
      under.set(above, [
        ...(under.get(above) ?? []),
        {
          leaving: row.leaving ?? starting.indexOf(row),
          notification: row.notification,
        },
      ]);
    }
  }
  return under;
};
