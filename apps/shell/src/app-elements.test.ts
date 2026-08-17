import { describe, expect, it } from "bun:test";

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";

import { AppElements } from "./app-elements";

type Call = readonly [kind: string, ...args: unknown[]];

/** A stand-in for the SDK's custom element, recording what was asked of it. */
const fakeElement = (calls: Call[]): DomicileAppElement =>
  ({
    applyCursor: (cursor: string) => {
      calls.push(["cursor", cursor]);
    },
    drawFrame: (width: number, height: number, scale: number) => {
      calls.push(["draw", width, height, scale]);
    },
    focusApp: () => {
      calls.push(["focus"]);
    },
    setSurfaceSize: (width: number, height: number) => {
      calls.push(["size", width, height]);
    },
  }) as unknown as DomicileAppElement;

const pixels = new Uint8Array([0, 0, 0, 255]);

describe("AppElements", () => {
  describe("routing host events", () => {
    it("draws a frame onto the element registered for its app", () => {
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.drawFrame({
        app_id: "term",
        height: 1,
        pixels,
        scale: 1,
        width: 1,
      });
      // The scale rides along: the element needs it to tell the buffer's
      // device pixels from the logical size it maps the pointer through.
      expect(calls).toStrictEqual([["draw", 1, 1, 1]]);
    });

    it("carries a resize to the element so it can scale pointer coordinates", () => {
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.resize({ app_id: "term", size: [640, 480] });
      expect(calls).toStrictEqual([["size", 640, 480]]);
    });

    it("carries a cursor shape to the element", () => {
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.applyCursor({ app_id: "term", cursor: "text" });
      expect(calls).toStrictEqual([["cursor", "text"]]);
    });

    it("drops a frame for an app the shell is not showing an element for", () => {
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.unregister("term");
      elements.drawFrame({
        app_id: "term",
        height: 1,
        pixels,
        scale: 1,
        width: 1,
      });
      expect(calls).toStrictEqual([]);
    });
  });

  describe("draw timing", () => {
    it("prices only the draws that actually happened", () => {
      const clock = [10, 17];
      const elements = new AppElements(() => clock.shift() ?? 0);
      elements.register("term", fakeElement([]));
      elements.drawFrame({
        app_id: "term",
        height: 1,
        pixels,
        scale: 1,
        width: 1,
      });
      elements.drawFrame({
        app_id: "ghost",
        height: 1,
        pixels,
        scale: 1,
        width: 1,
      });
      expect(elements.drawTiming.take()).toMatchObject({
        averageMs: 7,
        count: 1,
      });
    });
  });
});
