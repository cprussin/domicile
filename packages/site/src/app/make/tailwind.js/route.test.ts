import { expect, test } from "bun:test";

import { GET } from "./route";

test("serves Tailwind's browser build, for the preview's frame", async () => {
  const response = GET();

  expect(response.headers.get("content-type")).toBe("text/javascript");
  expect(await response.text()).toContain("tailwindcss");
});
