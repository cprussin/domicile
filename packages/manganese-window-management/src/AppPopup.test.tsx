import { describe, expect, it } from "bun:test";
import { APP_TAG_NAME } from "@domicile-desktop/sdk/app-element";
import { render } from "@testing-library/react";

import { AppPopup } from "./AppPopup";

describe("AppPopup", () => {
  it("shows the cursor its client asked for", () => {
    const { container } = render(
      <AppPopup
        popup={{
          appId: "menu",
          cursor: "pointer",
          depth: 0,
          frame: 0,
          rect: { height: 240, width: 180, x: 112, y: 80 },
        }}
      />,
    );

    expect(container.querySelector(APP_TAG_NAME)).toHaveStyle({
      cursor: "pointer",
    });
  });
});
