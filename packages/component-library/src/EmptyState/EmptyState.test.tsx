import { describe, expect, it } from "bun:test";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import { render, screen } from "@testing-library/react";

import { EmptyState } from "./EmptyState";

describe(EmptyState, () => {
  describe("rendering", () => {
    it("says what is missing, with a hint on what to do", () => {
      render(
        <EmptyState
          hint="Turn it on to see networks nearby."
          icon={WifiSlashIcon}
          title="Wi-Fi is off"
        />,
      );
      const state = screen.getByRole("status");
      expect(state).toHaveTextContent("Wi-Fi is off");
      expect(state).toHaveTextContent("Turn it on to see networks nearby.");
    });

    it("leaves the hint out when there is none", () => {
      render(<EmptyState icon={WifiSlashIcon} title="You're all caught up" />);
      expect(screen.getByRole("status")).toHaveTextContent(
        /^You're all caught up$/,
      );
    });
  });
});
