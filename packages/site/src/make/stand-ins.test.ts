import { describe, expect, it } from "bun:test";

import { launchedStandIn } from "./stand-ins";

describe("launchedStandIn", () => {
  it("shows the command typed, as text", () => {
    const { html, title } = launchedStandIn("launched-1", ["<b>", "&x"]);

    expect(title).toBe("<b>");
    expect(html).toContain("<b>&lt;b&gt;</b><span>&lt;b&gt; &amp;x</span>");
  });
});
