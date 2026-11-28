import { describe, expect, it } from "bun:test";
import {
  settled,
  started as startedOver,
} from "@domicile-desktop/app-host-client/fake";

import type { HistoryHost } from "./host";
import { spawnedHost } from "./host";

/** The host over fake processes, with what it already asked. */
const started = <T>(ask: (host: HistoryHost) => T) =>
  startedOver(spawnedHost, ask);

const QUERY = { endTime: 5, maxResults: 150, text: "a" };

describe(spawnedHost, () => {
  describe("requests", () => {
    it("searches the history, with each page's icon if it has one", async () => {
      const { asked, processes } = await started((host) => host.history(QUERY));
      expect(processes[0]?.sent).toEqual([
        { end_time: 5, id: 1, max_results: 150, text: "a", type: "history" },
      ]);
      processes[0]?.answer(
        {
          id: 1,
          items: [
            {
              favicon: "data:image/png;base64,QQ==",
              title: "A",
              url: "https://a.test/",
            },
            { favicon: null, title: "", url: "https://b.test/" },
          ],
          type: "history",
        },
        2,
      );
      expect(await asked).toEqual([
        {
          favicon: "data:image/png;base64,QQ==",
          title: "A",
          url: "https://a.test/",
        },
        { favicon: undefined, title: "", url: "https://b.test/" },
      ]);
    });

    it("gives a page's visit times", async () => {
      const { asked, processes } = await started((host) =>
        host.visits("https://a.test/"),
      );
      expect(processes[0]?.sent).toEqual([
        { id: 1, type: "visits", url: "https://a.test/" },
      ]);
      processes[0]?.answer({ id: 1, times: [10.5, 20], type: "visits" });
      expect(await asked).toEqual([10.5, 20]);
    });

    it("deletes visits, clears browsing data and opens a URL", async () => {
      const { asked, host, processes } = await started((host) =>
        host.deleteHistory([1000, 2000]),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "delete_history",
        visits: [1000, 2000],
      });
      processes[0]?.answer({ id: 1, type: "deleted" });
      await asked;

      const cleared = host.clearBrowsingData({
        origins: ["https://a.test"],
        since: 0,
        types: ["cookies"],
      });
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        origins: ["https://a.test"],
        since: 0,
        type: "clear_browsing_data",
        types: ["cookies"],
      });
      processes[0]?.answer({ id: 2, type: "cleared" });
      await cleared;

      const opened = host.openUrl("https://a.test/");
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 3,
        type: "open_url",
        url: "https://a.test/",
      });
      processes[0]?.answer({ id: 3, type: "opened" });
      await opened;
    });

    it("rejects with the host's reason when it refuses", async () => {
      const { asked, processes } = await started((host) =>
        host.clearBrowsingData({ since: 42, types: ["cache"] }),
      );
      expect(processes[0]?.sent).toEqual([
        { id: 1, since: 42, type: "clear_browsing_data", types: ["cache"] },
      ]);
      processes[0]?.answer({ id: 1, type: "refused", why: "profile is busy" });
      await expect(asked).rejects.toThrow("profile is busy");
    });

    it("rejects a reply of the wrong type", async () => {
      const { asked, processes } = await started((host) =>
        host.openUrl("https://a.test/"),
      );
      processes[0]?.answer({ id: 1, type: "deleted" });
      await expect(asked).rejects.toThrow(
        "The app host answered deleted, not opened",
      );
    });
  });
});
