import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";
import type { Gesture } from "./gestures";

const swiping: Gesture = {
  canceled: false,
  dx: -12,
  dy: 1.5,
  fingers: 3,
  kind: "swipe",
  phase: "update",
  rotation: 0,
  scale: 1,
};

describe("gestures", () => {
  it("grabs and gives back gestures", () => {
    const fake = new FakeDomicileHost();
    const { gestures } = desktop(fake.host);
    gestures.grab("swipe:3");
    gestures.ungrab("swipe:3");

    expect(fake.calls).toStrictEqual([
      ["grabGesture", "swipe:3"],
      ["ungrabGesture", "swipe:3"],
    ]);
  });

  it("hears each phase of a grabbed gesture", () => {
    const fake = new FakeDomicileHost();
    const heard: Gesture[] = [];
    desktop(fake.host).gestures.on("gesture", (gesture) => {
      heard.push(gesture);
    });
    fake.dispatch("gesture", swiping);

    expect(heard).toStrictEqual([swiping]);
  });

  it("skips a kind it does not know", () => {
    const fake = new FakeDomicileHost();
    const heard: Gesture[] = [];
    desktop(fake.host).gestures.on("gesture", (gesture) => {
      heard.push(gesture);
    });
    fake.dispatch("gesture", { ...swiping, kind: "rub" });

    expect(heard).toStrictEqual([]);
  });
});
