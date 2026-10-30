import { describe, expect, it } from "bun:test";

import type { Row } from "./drawer-rows";
import { nextRows } from "./drawer-rows";
import { notification } from "./fixture";

const one = notification({ id: 1 });
const two = notification({ id: 2 });
const three = notification({ id: 3 });

const staying = (...items: (typeof one)[]): Row[] =>
  items.map((item) => ({
    arriving: false,
    leaving: undefined,
    notification: item,
  }));

describe("nextRows", () => {
  it("is each notification, in order, staying", () => {
    expect(nextRows([], [one, two], false)).toEqual(staying(one, two));
  });

  it("has a notification new while it may animate arrive", () => {
    expect(nextRows(staying(one), [two, one], true)).toEqual([
      { arriving: true, leaving: undefined, notification: two },
      { arriving: false, leaving: undefined, notification: one },
    ]);
  });

  it("has none arrive when it may not animate, or once they have", () => {
    const rows = nextRows(staying(one), [two, one], true);

    expect(nextRows(rows, [two, one], false)).toEqual(staying(two, one));
  });

  it("keeps a cleared notification where it was, leaving", () => {
    expect(nextRows(staying(one, two, three), [one, three], true)).toEqual([
      { arriving: false, leaving: undefined, notification: one },
      { arriving: false, leaving: 0, notification: two },
      { arriving: false, leaving: undefined, notification: three },
    ]);
  });

  it("orders the notifications cleared together, top to bottom", () => {
    expect(nextRows(staying(one, two, three), [], true)).toEqual([
      { arriving: false, leaving: 0, notification: one },
      { arriving: false, leaving: 1, notification: two },
      { arriving: false, leaving: 2, notification: three },
    ]);
  });

  it("keeps a leaving row's order when more are cleared", () => {
    const rows = nextRows(staying(one, two, three), [one, three], true);

    expect(nextRows(rows, [], true)).toEqual([
      { arriving: false, leaving: 0, notification: one },
      { arriving: false, leaving: 0, notification: two },
      { arriving: false, leaving: 1, notification: three },
    ]);
  });

  it("keeps a leaving row under the one above it, past a new arrival", () => {
    const rows = nextRows(staying(one, two), [one], true);

    expect(nextRows(rows, [three, one], true)).toEqual([
      { arriving: true, leaving: undefined, notification: three },
      { arriving: false, leaving: undefined, notification: one },
      { arriving: false, leaving: 0, notification: two },
    ]);
  });

  it("stops a row leaving when its notification comes back", () => {
    const rows = nextRows(staying(one, two), [one], true);

    expect(nextRows(rows, [one, two], true)).toEqual(staying(one, two));
  });

  it("drops cleared rows at once when it may not animate", () => {
    const rows = nextRows(staying(one, two), [one], true);

    expect(nextRows(rows, [one], false)).toEqual(staying(one));
  });
});
