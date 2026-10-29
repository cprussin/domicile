import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Drilldown, DrilldownPage } from "./Drilldown";

/** A detail with a row that opens a page deeper in it. */
const Deeper = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Firefox
      </button>
      {open && (
        <DrilldownPage
          onBack={() => {
            setOpen(false);
          }}
          title="Firefox"
        >
          <p>where it plays</p>
        </DrilldownPage>
      )}
    </>
  );
};

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

  describe("pages", () => {
    it("slides a page opened from the detail over both views", async () => {
      render(
        <Drilldown
          detail={{ content: <Deeper />, title: "Sound" }}
          onBack={() => undefined}
        >
          <p>main</p>
        </Drilldown>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Firefox" }));

      expect(screen.getByRole("heading", { name: "Firefox" })).toBeVisible();
      expect(screen.getByText("where it plays")).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Sound" }),
      ).not.toBeInTheDocument();
    });

    it("goes back from a page to the view that opened it", async () => {
      render(
        <Drilldown>
          <Deeper />
        </Drilldown>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Firefox" }));

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(screen.getByRole("button", { name: "Firefox" })).toBeVisible();
      expect(screen.queryByText("where it plays")).not.toBeInTheDocument();
    });

    it("throws for a page outside a drilldown", () => {
      expect(() =>
        render(
          <DrilldownPage onBack={() => undefined} title="Firefox">
            <p>where it plays</p>
          </DrilldownPage>,
        ),
      ).toThrow("must be used within a <Drilldown>");
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
