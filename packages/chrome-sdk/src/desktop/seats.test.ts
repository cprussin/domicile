import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

describe("seats", () => {
  it("lists nothing until the compositor says", () => {
    expect(desktop(new FakeDomicileHost().host).seats.list).toBeUndefined();
  });

  it("lists each agent seat, with no pointer before it points, and takes and gives back a window", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      seats: [
        {
          focused: "app-2",
          holds: ["app-2"],
          id: "agent-3",
          name: "Claude Code",
          pointerX: 1100,
          pointerY: 240,
          taken: ["app-5"],
        },
        {
          focused: null,
          holds: [],
          id: "agent-4",
          name: "Codex",
          pointerX: null,
          pointerY: null,
          taken: [],
        },
      ],
    });
    const { seats } = desktop(fake.host);
    seats.takeOver("app-2");
    seats.giveBack("app-5");

    expect(seats.list).toStrictEqual([
      {
        focused: "app-2",
        holds: ["app-2"],
        id: "agent-3",
        name: "Claude Code",
        pointer: { x: 1100, y: 240 },
        taken: ["app-5"],
      },
      {
        focused: undefined,
        holds: [],
        id: "agent-4",
        name: "Codex",
        pointer: undefined,
        taken: [],
      },
    ]);
    expect(fake.calls).toStrictEqual([
      ["takeOver", "app-2"],
      ["giveBack", "app-5"],
    ]);
  });

  it("says the seats changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).seats.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ seats: [] });

    expect(await changed).toBeUndefined();
  });
});
