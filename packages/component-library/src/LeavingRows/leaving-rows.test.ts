import { describe, expect, it } from "bun:test";

import type { Leaving, Row } from "./leaving-rows";
import { closedOver, nextRows, slidOut, withRises } from "./leaving-rows";

type Item = { id: number };

const one = { id: 1 };
const two = { id: 2 };
const three = { id: 3 };

const idOf = ({ id }: Item) => id;

const next = (rows: readonly Row<Item>[], items: Item[], animate: boolean) =>
  nextRows(rows, items, idOf, animate);

const staying = (...items: Item[]): Row<Item>[] =>
  items.map((item) => ({ arriving: false, item, leaving: undefined }));

/** Leaving `order`-th, still sliding out. */
const sliding = (order: number): Leaving => ({
  closed: false,
  order,
  room: undefined,
});

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
      { arriving: false, item: two, leaving: sliding(0) },
      { arriving: false, item: three, leaving: undefined },
    ]);
  });

  it("orders the items removed together, top to bottom", () => {
    expect(next(staying(one, two, three), [], true)).toEqual([
      { arriving: false, item: one, leaving: sliding(0) },
      { arriving: false, item: two, leaving: sliding(1) },
      { arriving: false, item: three, leaving: sliding(2) },
    ]);
  });

  it("keeps a leaving row's order when more are removed", () => {
    const rows = next(staying(one, two, three), [one, three], true);

    expect(next(rows, [], true)).toEqual([
      { arriving: false, item: one, leaving: sliding(0) },
      { arriving: false, item: two, leaving: sliding(0) },
      { arriving: false, item: three, leaving: sliding(1) },
    ]);
  });

  it("keeps a leaving row under the one above it, past a new arrival", () => {
    const rows = next(staying(one, two), [one], true);

    expect(next(rows, [three, one], true)).toEqual([
      { arriving: true, item: three, leaving: undefined },
      { arriving: false, item: one, leaving: undefined },
      { arriving: false, item: two, leaving: sliding(0) },
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

describe(slidOut, () => {
  it("has a slid out row close over the room it takes", () => {
    const rows = next(staying(one, two, three), [one, three], true);

    expect(slidOut(rows, 2, idOf, 48)[1]?.leaving).toEqual({
      closed: false,
      order: 0,
      room: 48,
    });
  });
});

describe(closedOver, () => {
  const twoGone = () =>
    slidOut(next(staying(one, two, three), [three], true), 1, idOf, 40);

  it("keeps a closed row while another still leaves", () => {
    const rows = closedOver(twoGone(), 1, idOf);

    expect(rows.map(({ leaving }) => leaving?.closed)).toEqual([
      true,
      false,
      undefined,
    ]);
  });

  it("drops every leaving row once all are closed over", () => {
    const rows = closedOver(
      closedOver(slidOut(twoGone(), 2, idOf, 40), 1, idOf),
      2,
      idOf,
    );

    expect(rows).toEqual(staying(three));
  });
});

describe(withRises, () => {
  it("raises each row by the room of the closing rows above it", () => {
    const rows = slidOut(
      slidOut(next(staying(one, two, three), [three], true), 1, idOf, 40),
      2,
      idOf,
      56,
    );

    expect(withRises(rows).map(({ rise }) => rise)).toEqual([0, 40, 96]);
  });

  it("raises none for rows still sliding out", () => {
    expect(
      withRises(next(staying(one, two), [two], true)).map(({ rise }) => rise),
    ).toEqual([0, 0]);
  });
});
