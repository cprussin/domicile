import { describe, expect, it } from "bun:test";

import { recordedRequests } from "./recorded-requests";

describe("recordedRequests", () => {
  it("records each request in order and answers it", async () => {
    const { ask, asked } = recordedRequests(([name]) => `${name} done`);
    expect(await ask(["first", 1])).toBe("first done");
    expect(await ask(["second"])).toBe("second done");
    expect(asked).toEqual([["first", 1], ["second"]]);
  });
});
