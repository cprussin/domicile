import { describe, expect, it } from "bun:test";
import { listedWindow } from "@domicile-desktop/sdk/fake-host";

import { floatingRulesSchema } from "./floating/floating-rules";
import { windowChanges } from "./window-changes";
import { WindowAction } from "./window-state";

const TERM = listedWindow("term", { title: "Terminal" });
const NO_RULES = floatingRulesSchema.parse([]);

describe("windowChanges", () => {
  describe("a window that appeared", () => {
    it("is announced with its title", () => {
      expect(windowChanges(NO_RULES, [], [TERM])).toStrictEqual([
        WindowAction.AppAppeared("term", "Terminal"),
      ]);
    });

    it("is announced unnamed while its client has not named it", () => {
      expect(windowChanges(NO_RULES, [], [listedWindow("term")])).toStrictEqual(
        [WindowAction.AppAppeared("term", undefined)],
      );
    });

    it("says the limits and the cursor its client already asked for", () => {
      expect(
        windowChanges(
          NO_RULES,
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

    it("says the desktop entry its client already named", () => {
      expect(
        windowChanges(
          NO_RULES,
          [],
          [{ ...TERM, desktopId: "org.example.Term" }],
        ),
      ).toStrictEqual([
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppDesktopIdChanged("term", "org.example.Term"),
      ]);
    });

    it("opens floating at the size it drew, for a dialog", () => {
      expect(
        windowChanges(
          NO_RULES,
          [],
          [{ ...TERM, dialog: true, height: 300, width: 400 }],
        ),
      ).toStrictEqual([
        WindowAction.AppAppearedFloating("term", "Terminal", [400, 300], false),
      ]);
    });

    it("opens floating without its title bar when it draws its own frame", () => {
      expect(
        windowChanges(
          NO_RULES,
          [],
          [
            {
              ...TERM,
              clientFrame: true,
              dialog: true,
              height: 300,
              width: 400,
            },
          ],
        ),
      ).toStrictEqual([
        WindowAction.AppAppearedFloating("term", "Terminal", [400, 300], true),
      ]);
    });

    it("opens floating when a rule names it", () => {
      expect(
        windowChanges(
          floatingRulesSchema.parse([{ title: "^Term" }]),
          [],
          [{ ...TERM, height: 300, width: 400 }],
        ),
      ).toStrictEqual([
        WindowAction.AppAppearedFloating("term", "Terminal", [400, 300], false),
      ]);
    });

    it("is placed, for a popup", () => {
      expect(
        windowChanges(
          NO_RULES,
          [TERM],
          [
            TERM,
            listedWindow("menu", {
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
          frame: 0,
          parent: "term",
          position: [10, 20],
          size: [100, 200],
        }),
      ]);
    });

    it("says the synced frame it is at, for one that appeared before the page", () => {
      expect(
        windowChanges(NO_RULES, [], [{ ...TERM, frame: 3 }]),
      ).toStrictEqual([
        WindowAction.AppAppeared("term", "Terminal"),
        WindowAction.AppFrameSynced("term", 3),
      ]);
    });
  });

  describe("a window that changed", () => {
    it("says only what changed", () => {
      expect(
        windowChanges(
          NO_RULES,
          [TERM],
          [{ ...TERM, title: "vim", width: 640 }],
        ),
      ).toStrictEqual([WindowAction.AppTitled("term", "vim")]);
    });

    it("says the desktop entry its client names later", () => {
      // Clients usually set their app id after their toplevel appears.
      expect(
        windowChanges(
          NO_RULES,
          [TERM],
          [{ ...TERM, desktopId: "org.example.Term" }],
        ),
      ).toStrictEqual([
        WindowAction.AppDesktopIdChanged("term", "org.example.Term"),
      ]);
    });

    it("says its new limits", () => {
      expect(
        windowChanges(
          NO_RULES,
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
        windowChanges(NO_RULES, [TERM], [{ ...TERM, cursor: "pointer" }]),
      ).toStrictEqual([WindowAction.AppCursorChanged("term", "pointer")]);
    });

    it("places a popup that moved", () => {
      const menu = listedWindow("menu", {
        height: 200,
        parent: "term",
        width: 100,
        x: 10,
        y: 20,
      });

      expect(
        windowChanges(NO_RULES, [TERM, menu], [TERM, { ...menu, x: 30 }]),
      ).toStrictEqual([
        WindowAction.PopupPlaced({
          appId: "menu",
          frame: 0,
          parent: "term",
          position: [30, 20],
          size: [100, 200],
        }),
      ]);
    });

    it("says the synced frames a move shows with, in the same changes", () => {
      // The compositor names them in the move's message, so a page that sets
      // them in one render shows the window's content and its bubble together.
      const menu = listedWindow("menu", {
        height: 200,
        parent: "term",
        width: 100,
        x: 10,
        y: 20,
      });

      expect(
        windowChanges(
          NO_RULES,
          [TERM, menu],
          [
            { ...TERM, frame: 4 },
            { ...menu, frame: 1, y: 40 },
          ],
        ),
      ).toStrictEqual([
        WindowAction.AppFrameSynced("term", 4),
        WindowAction.PopupPlaced({
          appId: "menu",
          frame: 1,
          parent: "term",
          position: [10, 40],
          size: [100, 200],
        }),
      ]);
    });

    it("says nothing for a window that did not change", () => {
      expect(windowChanges(NO_RULES, [TERM], [TERM])).toStrictEqual([]);
    });
  });

  it("closes a window that is gone", () => {
    expect(windowChanges(NO_RULES, [TERM], [])).toStrictEqual([
      WindowAction.AppClosed("term"),
    ]);
  });
});
