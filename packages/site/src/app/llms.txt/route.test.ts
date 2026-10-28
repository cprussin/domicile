import { expect, test } from "bun:test";

import { PAGES } from "../../docs/pages";
import { GET } from "./route";

const text = () => GET().text();

test("is llms.txt: a title, a summary, then sections of links", async () => {
  const body = await text();

  expect(GET().headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(body).toStartWith("# Domicile\n\n> ");
  expect(body).toContain("\n## Docs\n");
});

test("links every docs page, by its full URL", async () => {
  const body = await text();

  for (const page of PAGES) {
    expect(body).toContain(
      `[${page.title}](https://domicile-desktop.com/docs/${page.slug})`,
    );
  }
});

test("says what an agent gets wrong without it", async () => {
  const body = await text();

  for (const fact of [
    "export const Shell = mount(Desktop);",
    'import "@tailwindcss/browser";',
    "domicile load-shell",
    "window.parent === undefined",
    "NestedShell",
  ]) {
    expect(body).toContain(fact);
  }
});
