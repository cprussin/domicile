import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Backticked } from "./Backticked";

test("sets each backticked span as code", () => {
  expect(
    renderToStaticMarkup(<Backticked text="run `domicile` then `ls`." />),
  ).toMatch(/^run <code[^>]*>domicile<\/code> then <code[^>]*>ls<\/code>\.$/);
});
