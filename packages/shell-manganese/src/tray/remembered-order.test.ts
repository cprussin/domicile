import { beforeEach, describe, expect, it } from "bun:test";

import { rememberedOrder, rememberOrder } from "./remembered-order";

const ORDER_KEY = "tray-order:v1";

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("the tray's remembered order", () => {
  it("is empty on a machine that has not seen one", () => {
    expect(rememberedOrder()).toStrictEqual([]);
  });

  it("is the order last written", () => {
    rememberOrder(["b", "a"]);
    expect(rememberedOrder()).toStrictEqual(["b", "a"]);
  });

  it("ignores a value that is not an order", () => {
    globalThis.localStorage.setItem(ORDER_KEY, '{"a":1}');
    expect(rememberedOrder()).toStrictEqual([]);
    globalThis.localStorage.setItem(ORDER_KEY, "not json");
    expect(rememberedOrder()).toStrictEqual([]);
  });
});
