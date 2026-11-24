import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

describe("session", () => {
  it("reads nothing until the compositor says", () => {
    const { session } = desktop(new FakeDomicileHost().host);

    expect(session.idle).toBeUndefined();
    expect(session.locked).toBeUndefined();
  });

  it("reads whether the desk is idle and locked", () => {
    const fake = new FakeDomicileHost();
    fake.set({ idle: true, locked: false });
    const { session } = desktop(fake.host);

    expect(session.idle).toBe(true);
    expect(session.locked).toBe(false);
  });

  it("locks and unlocks", () => {
    const fake = new FakeDomicileHost();
    const { session } = desktop(fake.host);
    session.lock();
    session.unlock("hunter2");

    expect(fake.calls).toStrictEqual([["lock"], ["unlock", "hunter2"]]);
  });

  it("watches for idle, holds and refusals through the compositor", () => {
    const fake = new FakeDomicileHost();
    const { session } = desktop(fake.host);
    const never = () => {
      /* never answered */
    };
    session.idleAfter(120).catch(never);
    session.idleBeforeBlanking(30).catch(never);
    session.idleHolds().catch(never);
    session.unlockRefusals().catch(never);

    expect(fake.calls).toStrictEqual([
      ["callSystem", 1, JSON.stringify({ call: "idle_after", seconds: 120 })],
      [
        "callSystem",
        2,
        JSON.stringify({ call: "idle_before_blanking", seconds: 30 }),
      ],
      ["callSystem", 3, JSON.stringify({ call: "idle_holds" })],
      ["callSystem", 4, JSON.stringify({ call: "unlock_refusals" })],
    ]);
  });

  it("says idle and lock changed apart", () => {
    const fake = new FakeDomicileHost();
    const { session } = desktop(fake.host);
    const heard: string[] = [];
    session.on("idlechange", () => {
      heard.push("idlechange");
    });
    session.on("lockchange", () => {
      heard.push("lockchange");
    });
    fake.set({ idle: true });
    fake.set({ locked: true });

    expect(heard).toStrictEqual(["idlechange", "lockchange"]);
  });
});
