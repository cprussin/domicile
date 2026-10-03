import { describe, expect, it, spyOn } from "bun:test";
import { act, within } from "@testing-library/react";

import { runManganese } from "./index";

describe("runManganese", () => {
  // The library's whole promise: a layout of the user's own, on the bar of a
  // desktop they did not have to build.
  it("mounts manganese into the root with the bar it is given", async () => {
    // A page with no compositor says so once on the console, which is the
    // case here and not the thing under test.
    const said = spyOn(console, "warn").mockImplementation(() => undefined);
    // Never put in the document: a desktop this test cannot unmount would
    // still be on the page every later test queries.
    const root = document.createElement("div");

    act(() => {
      runManganese({
        topBar: {
          left: [<span key="mail">mail 3/12</span>],
          middle: [],
          right: [],
        },
      })(root);
    });

    expect(root).toContainElement(await within(root).findByText("mail 3/12"));
    said.mockRestore();
  });
});
