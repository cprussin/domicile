import { describe, expect, it } from "bun:test";

import type { Row } from "./leaving-rows";
import { nextRows } from "./leaving-rows";

type Item = { id: number };

const one = { id: 1 };
const two = { id: 2 };
const three = { id: 3 };

const idOf = ({ id }: Item) => id;

const next = (rows: readonly Row<Item>[], items: Item[], animate: boolean) =>
  nextRows(rows, items, idOf, animate);

const staying = (...items: Item[]): Row<Item>[] =>
  items.map((item) => ({ arriving: false, item, leaving: undefined }));

describe(nextRows, () => {
  it("is each item, in order, staying", () => {
    expect(next([], [one, two], false)).toEqual(staying(one, two));
  });

  it("has an item new while it may animate arrive", () => {
    expect(next(staying(one), [two, one], true)).toEqual([
      { arriving: true, item: two, leaving: undefined },
      { arriving: false, item: one, leaving: undefined },
    ]);
  });

  it("has none arrive when it may not animate, or once they have", () => {
    const rows = next(staying(one), [two, one], true);

    expect(next(rows, [two, one], false)).toEqual(staying(two, one));
  });

  it("keeps a removed item where it was, leaving", () => {
    expect(next(staying(one, two, three), [one, three], true)).toEqual([
      { arriving: false, item: one, leaving: undefined },
      { arriving: false, item: two, leaving: 0 },
      { arriving: false, item: three, leaving: undefined },
    ]);
  });

  it("orders the items removed together, top to bottom", () => {
    expect(next(staying(one, two, three), [], true)).toEqual([
      { arriving: false, item: one, leaving: 0 },
      { arriving: false, item: two, leaving: 1 },
      { arriving: false, item: three, leaving: 2 },
    ]);
  });

  it("keeps a leaving row's order when more are removed", () => {
    const rows = next(staying(one, two, three), [one, three], true);

    expect(next(rows, [], true)).toEqual([
      { arriving: false, item: one, leaving: 0 },
      { arriving: false, item: two, leaving: 0 },
      { arriving: false, item: three, leaving: 1 },
    ]);
  });

  it("keeps a leaving row under the one above it, past a new arrival", () => {
    const rows = next(staying(one, two), [one], true);

    expect(next(rows, [three, one], true)).toEqual([
      { arriving: true, item: three, leaving: undefined },
      { arriving: false, item: one, leaving: undefined },
      { arriving: false, item: two, leaving: 0 },
    ]);
  });

  it("stops a row leaving when its item comes back", () => {
    const rows = next(staying(one, two), [one], true);

    expect(next(rows, [one, two], true)).toEqual(staying(one, two));
  });

  it("drops removed rows at once when it may not animate", () => {
    const rows = next(staying(one, two), [one], true);

    expect(next(rows, [one], false)).toEqual(staying(one));
  });

  it("keeps an item's newer copy", () => {
    const newer = { ...one };

    expect(next(staying(one), [newer], true)[0]?.item).toBe(newer);
  });
});
