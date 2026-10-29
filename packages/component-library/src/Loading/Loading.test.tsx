import { describe, expect, it } from "bun:test";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import { render, screen } from "@testing-library/react";

import { Loading } from "./Loading";

describe(Loading, () => {
  describe("rendering", () => {
    it("says what it is waiting for", () => {
      render(<Loading>Checking Wi-Fi…</Loading>);
      expect(screen.getByRole("status")).toHaveTextContent("Checking Wi-Fi…");
    });

    it("keeps its words for assistive tech as a glyph alone", () => {
      render(<Loading layout="glyph">Checking</Loading>);
      const status = screen.getByRole("status", { name: "Checking" });
      expect(status).toHaveTextContent(/^$/);
    });

    it("searches with what it is looking for in place of the spinner", () => {
      render(<Loading icon={WifiHighIcon}>Looking for networks…</Loading>);
      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("data-searching");
      expect(status).toHaveTextContent("Looking for networks…");
    });
  });
});
