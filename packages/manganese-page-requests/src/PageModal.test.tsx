import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { css } from "../styled-system/css";
import { PageModal } from "./PageModal";

describe("PageModal", () => {
  // It sits at the top of the page that asked, so it grows from there.
  it("springs in over the page that asked", () => {
    render(
      <PageModal
        footer={undefined}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
        title="Leave site?"
      />,
    );

    expect(screen.getByRole("alertdialog").className).toContain(
      css({
        transition:
          "opacity {durations.normal} {easings.out}, transform {durations.springs.smooth} {easings.springs.smooth}",
      }),
    );
  });
});
