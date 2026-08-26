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
    dropSurface: () => {
      calls.push(["drop"]);
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
  describe("a client that already had a surface", () => {
    it("tells an element that mounts after the announcement", () => {
      // The announcement carries a size only for a client that has committed
      // at least once — the replay a reloading chrome gets — and the element
      // does not exist yet when it arrives, because React mounts it a render
      // later. Nothing else would tell it: where the compositor draws the
      // client itself no frame comes, and `app_resized` answers only a size
      // that changed, so an idle client sends neither. The placeholder would
      // be painted over the live window until the user resized it.
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.announced("term", [640, 480]);
      elements.register("term", fakeElement(calls));
      expect(calls).toStrictEqual([["size", 640, 480]]);
    });

    it("tells one that is already mounted", () => {
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.announced("term", [640, 480]);
      expect(calls).toStrictEqual([["size", 640, 480]]);
    });

    it("says nothing to a mounted element about a client that has not drawn", () => {
      // The replay goes out to every chrome whenever any chrome shakes hands,
      // so this chrome hears about its own windows again — an undrawn one
      // among them, announced with no size at all. Its element is mounted by
      // then, so nothing downstream would shrug the message off.
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.announced("term", undefined);
      expect(calls).toStrictEqual([]);
    });

    it("remembers the size the client last drew at, not the announced one", () => {
      // The record outlives the element, so it has to stay current: a client
      // that resized after its announcement and then had its portal remounted
      // would otherwise be handed a size it has left behind, and on the native
      // path nothing is coming to correct it.
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.announced("term", [640, 480]);
      elements.register("term", fakeElement(calls));
      elements.resize({ app_id: "term", size: [800, 600] });
      elements.unregister("term");

      const remounted: Call[] = [];
      elements.register("term", fakeElement(remounted));
      expect(remounted).toStrictEqual([["size", 800, 600]]);
    });

    it("does not take a copied frame's physical pixels for the size", () => {
      // A frame carries device pixels and the scale to divide them by, and
      // only the element holds that conversion — so recording one here would
      // put `1920x1080` behind a client whose surface is `960x540`, and the
      // next portal to mount would map every click at twice its distance.
      // Nothing is lost by leaving it: `note_content_size` runs on the
      // logical size for a copied frame too, so a frame at a new size has
      // already sent the `app_resized` that records it.
      const elements = new AppElements();
      elements.register("term", fakeElement([]));
      elements.drawFrame({
        app_id: "term",
        height: 1080,
        pixels,
        scale: 2,
        width: 1920,
      });
      elements.unregister("term");

      const remounted: Call[] = [];
      elements.register("term", fakeElement(remounted));
      expect(remounted).toStrictEqual([]);
    });

    it("drops the record when the client goes", () => {
      // Not when its portal unmounts: the shell stops rendering a window for
      // reasons the client knows nothing about — an empty display list, say —
      // and the client is still running and still drawn behind it.
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.announced("term", [640, 480]);
      elements.register("term", fakeElement(calls));
      elements.unregister("term");

      const remounted: Call[] = [];
      elements.register("term", fakeElement(remounted));
      expect(remounted).toStrictEqual([["size", 640, 480]]);

      elements.closed("term");
      const afterClose: Call[] = [];
      elements.register("term", fakeElement(afterClose));
      expect(afterClose).toStrictEqual([]);
    });
  });

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

    it("carries the host taking a window back to the element", () => {
      // The compositor is drawing this window's own buffer now, so the pixels
      // the element holds are a still of a live window — and the chrome is
      // composited over the client, so that still would hide it.
      const calls: Call[] = [];
      const elements = new AppElements();
      elements.register("term", fakeElement(calls));
      elements.composited({ app_id: "term" });
      expect(calls).toStrictEqual([["drop"]]);
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
