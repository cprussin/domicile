import { describe, expect, it } from "bun:test";

import { eachOf } from "./streams";

describe(eachOf, () => {
  it("hands over every item, in order, until the stream closes", async () => {
    const seen: number[] = [];
    await eachOf(
      new ReadableStream<number>({
        start: (controller) => {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
      }),
      (item) => seen.push(item),
    );
    expect(seen).toEqual([1, 2]);
  });
});
