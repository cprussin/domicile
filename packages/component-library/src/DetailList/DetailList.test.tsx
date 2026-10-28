import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { DetailList } from "./DetailList";

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
  });
});
