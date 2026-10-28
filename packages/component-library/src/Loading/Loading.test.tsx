import { describe, expect, it } from "bun:test";
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
  });
});
