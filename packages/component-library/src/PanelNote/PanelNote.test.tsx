import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { PanelNote } from "./PanelNote";

describe(PanelNote, () => {
  describe("rendering", () => {
    it("says how things stand", () => {
      render(<PanelNote>Searching for devices…</PanelNote>);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Searching for devices…",
      );
    });

    it("marks a warning, keeping the service's words for its tooltip", () => {
      render(
        <PanelNote
          detail="net.connman.iwd.NotSupported: Operation not supported"
          tone="warning"
        >
          Couldn't look for networks
        </PanelNote>,
      );
      const note = screen.getByRole("status");
      expect(note).toHaveTextContent("Couldn't look for networks");
      expect(note).toHaveAttribute(
        "title",
        "net.connman.iwd.NotSupported: Operation not supported",
      );
      expect(screen.getByRole("img", { name: "Warning" })).toBeInTheDocument();
    });
  });
});
