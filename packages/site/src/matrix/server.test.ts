import { expect, test } from "bun:test";

import { GET } from "./server";

test("points Matrix federation at the site itself", async () => {
  expect(await GET().json()).toEqual({
    "m.server": "www.domicile-desktop.com:443",
  });
});
