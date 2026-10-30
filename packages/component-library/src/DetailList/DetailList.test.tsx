import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DetailList } from "./DetailList";

loadEmittedStylesheet(
  document,
  new URL("../../styled-system/styles.css", import.meta.url),
);

describe(DetailList, () => {
  describe("rendering", () => {
    it("pairs each term with its value, a value of several lines one to a line", () => {
      render(
        <DetailList
          rows={[
            ["Frequency", "5785 MHz (5 GHz)"],
            ["Address", ["10.42.0.17/24", "2600:1702::1/64"]],
          ]}
        />,
      );
      const terms = screen.getAllByRole("term");
      const values = screen.getAllByRole("definition");
      expect(terms.map((term) => term.textContent)).toEqual([
        "Frequency",
        "Address",
      ]);
      expect(values[0]).toHaveTextContent("5785 MHz (5 GHz)");
      expect(
        Array.from(values[1]?.children ?? [], (line) => line.textContent),
      ).toEqual(["10.42.0.17/24", "2600:1702::1/64"]);
    });

    it("lets a value be selected, in a shell that turns selection off", () => {
      render(<DetailList rows={[["Gateway", "10.42.0.1"]]} />);
      expect(
        globalThis.getComputedStyle(screen.getByRole("definition")).userSelect,
      ).toBe("text");
    });

    it("offers a copy button only on a copyable value", () => {
      render(
        <DetailList
          rows={[
            ["Speed", "866 Mbps"],
            ["Gateway", "10.42.0.1", { copyable: true }],
          ]}
        />,
      );
      expect(
        screen
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(["Copy 10.42.0.1"]);
    });

    it("breaks an address only between its groups, and grays its prefix length", () => {
      const { container } = render(
        <DetailList
          rows={[
            [
              "IPv6 address",
              "2600:1702:4b80:438f:2a0c:50ff:fe33:91aa/64",
              { address: true },
            ],
          ]}
        />,
      );
      const value = screen.getByRole("definition");
      expect(value).toHaveTextContent(
        "2600:1702:4b80:438f:2a0c:50ff:fe33:91aa/64",
      );
      expect(
        Array.from(container.querySelectorAll("wbr"), (wbr) =>
          wbr.previousSibling?.textContent?.at(-1),
        ),
      ).toEqual([":", ":", ":", ":", ":", ":", ":"]);
      expect(globalThis.getComputedStyle(screen.getByText("/64")).color).toBe(
        globalThis.getComputedStyle(screen.getByRole("term")).color,
      );
    });
  });

  describe("interactions", () => {
    it("copies the line its button sits on", async () => {
      render(
        <DetailList
          rows={[
            [
              "Address",
              ["10.42.0.17/24", "2600:1702::1/64"],
              { copyable: true },
            ],
          ]}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Copy 2600:1702::1/64" }),
      );
      expect(await navigator.clipboard.readText()).toBe("2600:1702::1/64");
    });

    it("says it copied, for a moment", async () => {
      render(
        <DetailList rows={[["Gateway", "10.42.0.1", { copyable: true }]]} />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Copy 10.42.0.1" }),
      );
      await screen.findByRole("button", { name: "Copied 10.42.0.1" });
      await waitForElementToBeRemoved(
        () => screen.queryByRole("button", { name: "Copied 10.42.0.1" }),
        { timeout: 3000 },
      );
      expect(
        screen.getByRole("button", { name: "Copy 10.42.0.1" }),
      ).toBeInTheDocument();
    });
  });
});
