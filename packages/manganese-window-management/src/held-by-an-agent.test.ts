import { describe, expect, it } from "bun:test";
import type { Seat } from "@domicile-desktop/sdk/desktop/seats";

import { heldByAnAgent } from "./held-by-an-agent";
import { appWindowId, browserWindowId } from "./window";

const seat = (holds: readonly string[]): Seat => ({
  focused: undefined,
  holds,
  id: "agent-3",
  name: "Claude Code",
  pointer: undefined,
  taken: [],
});

describe("heldByAnAgent", () => {
  it("names a client's window by its app id and a browser window by its engine id", () => {
    const seats = [seat(["kD3mQ7nW", "7"])];

    expect(heldByAnAgent(seats, appWindowId("kD3mQ7nW"))).toBe(true);
    expect(heldByAnAgent(seats, browserWindowId("7"))).toBe(true);
    expect(heldByAnAgent(seats, appWindowId("nW1zT5yB"))).toBe(false);
    expect(heldByAnAgent(seats, browserWindowId("8"))).toBe(false);
  });

  it("holds nothing before the compositor lists the seats", () => {
    expect(heldByAnAgent(undefined, appWindowId("kitty"))).toBe(false);
  });
});
