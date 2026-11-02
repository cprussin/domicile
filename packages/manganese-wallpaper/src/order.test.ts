import { describe, expect, it } from "bun:test";

import { inOrder, shuffledOrder } from "./order";

const PHOTOS = Array.from({ length: 20 }, (_, index) => `p${index.toString()}`);

describe("shuffledOrder", () => {
  it("shows every photograph once a pass", () => {
    const order = shuffledOrder(1);
    for (const pass of [0, 1, 7]) {
      expect(order(PHOTOS, pass).toSorted()).toEqual(PHOTOS.toSorted());
    }
  });

  it("gives a pass the same order every time it is asked", () => {
    expect(shuffledOrder(1)(PHOTOS, 3)).toEqual(shuffledOrder(1)(PHOTOS, 3));
  });

  it("reshuffles each pass", () => {
    const order = shuffledOrder(1);
    expect(order(PHOTOS, 1)).not.toEqual(order(PHOTOS, 0));
    expect(order(PHOTOS, 0)).not.toEqual(PHOTOS);
  });

  it("shuffles differently for another seed", () => {
    expect(shuffledOrder(2)(PHOTOS, 0)).not.toEqual(
      shuffledOrder(1)(PHOTOS, 0),
    );
  });

  it("never shows a photograph twice in a row across passes", () => {
    const three = ["a", "b", "c"];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const order = shuffledOrder(seed);
      for (let pass = 1; pass < 50; pass++) {
        expect(order(three, pass)[0]).not.toBe(order(three, pass - 1).at(-1));
      }
    }
  });

  it("keeps two photographs alternating", () => {
    const order = shuffledOrder(1);
    expect(order(["a", "b"], 0)).toEqual(["a", "b"]);
    expect(order(["a", "b"], 5)).toEqual(["a", "b"]);
  });
});

describe("inOrder", () => {
  it("shows the photographs as given", () => {
    expect(inOrder(PHOTOS, 4)).toEqual(PHOTOS);
  });
});
