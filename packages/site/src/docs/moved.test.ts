import { describe, expect, test } from "bun:test";

import { MOVED, movedRedirects } from "./moved";
import { pageAt } from "./pages";

describe("moved docs routes", () => {
  test("each goes to a page that exists", () => {
    expect(
      Object.values(MOVED).filter((to) => pageAt(to.split("/")) === undefined),
    ).toEqual([]);
  });

  test("none is still a page", () => {
    expect(
      Object.keys(MOVED).filter(
        (from) => pageAt(from.split("/")) !== undefined,
      ),
    ).toEqual([]);
  });

  test("redirect permanently under /docs", () => {
    expect(movedRedirects()).toContainEqual({
      destination: "/docs/manganese/monitors",
      permanent: true,
      source: "/docs/manganese/displays",
    });
  });
});
