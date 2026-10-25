import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act } from "@testing-library/react";

import { Shell } from "./index";

describe("Shell", () => {
  // The page draws nothing until `Shell` returns, so the desktop must be in it
  // by then.
  it("draws the desktop before it returns", () => {
    const fake = new FakeDomicileHost();
    const root = document.createElement("div");
    act(() => {
      Shell(root, fake.domicile);
      // The mount point, and the desktop's element in it.
      expect(root.firstElementChild?.firstElementChild).toBeInstanceOf(
        HTMLDivElement,
      );
    });
  });
});
