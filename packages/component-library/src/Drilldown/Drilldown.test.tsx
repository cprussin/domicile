import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Drilldown } from "./Drilldown";

describe(Drilldown, () => {
  describe("rendering", () => {
    it("shows its main view while there is no detail", () => {
      render(
        <Drilldown detail={undefined} onBack={() => undefined}>
          <button type="button">Speakers</button>
        </Drilldown>,
      );

      expect(screen.getByRole("button", { name: "Speakers" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
    });

    it("slides the detail in over the main view, which leaves the way", () => {
      render(
        <Drilldown
          detail={{ content: <p>the ports</p>, title: "Port" }}
          onBack={() => undefined}
        >
          <button type="button">Speakers</button>
        </Drilldown>,
      );

      expect(screen.getByRole("heading", { name: "Port" })).toBeVisible();
      expect(screen.getByText("the ports")).toBeVisible();
      // Out of the way of a keyboard and a screen reader, not only the eye.
      expect(
        screen.queryByRole("button", { name: "Speakers" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("asks to go back", async () => {
      const backed = new Promise((resolve) => {
        render(
          <Drilldown
            detail={{ content: <p>the ports</p>, title: "Port" }}
            onBack={() => {
              resolve(true);
            }}
          >
            <p>main</p>
          </Drilldown>,
        );
      });
      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(await backed).toBe(true);
    });
  });
});
