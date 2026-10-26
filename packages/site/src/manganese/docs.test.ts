import { describe, expect, test } from "bun:test";

import { pageAt } from "../docs/pages";
import { DOCS } from "./docs";

describe("manganese's docs links", () => {
  test("each /docs link is a page", () => {
    const routes = DOCS.flatMap((column) => column.links)
      .map((link) => link.href)
      .filter((href) => href.startsWith("/docs/"))
      .map((href) => href.slice("/docs/".length).split("#")[0] ?? "");
    expect(
      routes.filter((route) => pageAt(route.split("/")) === undefined),
    ).toEqual([]);
  });
});
