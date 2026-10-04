import { describe, expect, it } from "bun:test";
import { describedWindow } from "@domicile-desktop/sdk/fake-host";

import { windowChanges } from "./window-changes";
import { WindowAction } from "./window-state";

const TERM = describedWindow("term", { title: "Terminal" });

describe("windowChanges", () => {
  describe("a window that appeared", () => {
    it("is announced with its title", () => {
      expect(windowChanges([], [TERM])).toStrictEqual([
        WindowAction.AppAppeared("term", "Terminal"),
      ]);
    });

    it("is announced unnamed while its client has not named it", () => {
      expect(windowChanges([], [describedWindow("term")])).toStrictEqual([
        WindowAction.AppAppeared("term", undefined),
      ]);
    });

    it("says the limits and the cursor its client already asked for", () => {
      expect(
        windowChanges(
          [],
          [{ ...TERM, cursor: "text", maxWidth: 800, minHeight: 100 }],
        ),
      ).toStrictEqual([
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppMinSize("term", [undefined, 100]),
        WindowAction.AppMaxSize("term", [800, undefined]),
        WindowAction.AppCursorChanged("term", "text"),
      ]);
    });

    it("is placed, for a popup", () => {
      expect(
        windowChanges(
          [TERM],
          [
            TERM,
            describedWindow("menu", {
              height: 200,
              parent: "term",
              width: 100,
              x: 10,
              y: 20,
            }),
          ],
        ),
      ).toStrictEqual([
        WindowAction.PopupPlaced({
          appId: "menu",
          parent: "term",
          position: [10, 20],
          size: [100, 200],
        }),
      ]);
    });
  });

  describe("a window that changed", () => {
    it("says only what changed", () => {
      expect(
        windowChanges([TERM], [{ ...TERM, title: "vim", width: 640 }]),
      ).toStrictEqual([WindowAction.AppTitled("term", "vim")]);
    });

    it("says its new limits", () => {
      expect(
        windowChanges(
          [TERM],
          [{ ...TERM, maxHeight: 600, minHeight: 100, minWidth: 200 }],
        ),
      ).toStrictEqual([
        WindowAction.AppMinSize("term", [200, 100]),
        WindowAction.AppMaxSize("term", [undefined, 600]),
      ]);
    });

    it("says its new cursor", () => {
      expect(
        windowChanges([TERM], [{ ...TERM, cursor: "pointer" }]),
      ).toStrictEqual([WindowAction.AppCursorChanged("term", "pointer")]);
    });

    it("places a popup that moved", () => {
      const menu = describedWindow("menu", {
        height: 200,
        parent: "term",
        width: 100,
        x: 10,
        y: 20,
      });

      expect(
        windowChanges([TERM, menu], [TERM, { ...menu, x: 30 }]),
      ).toStrictEqual([
        WindowAction.PopupPlaced({
          appId: "menu",
          parent: "term",
          position: [30, 20],
          size: [100, 200],
        }),
      ]);
    });

    it("says nothing for a window that did not change", () => {
      expect(windowChanges([TERM], [TERM])).toStrictEqual([]);
    });
  });

  it("closes a window that is gone", () => {
    expect(windowChanges([TERM], [])).toStrictEqual([
      WindowAction.AppClosed("term"),
    ]);
  });
});
