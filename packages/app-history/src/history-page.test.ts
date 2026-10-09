import { describe, expect, it } from "bun:test";

import { fakeHistory } from "./fake-history";
import { loadPage, loadSince } from "./history-page";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

const OWN = "chrome-extension://dimbckmbklbplcobppahmnepgiponamj/";

describe(loadPage, () => {
  it("shows each page once per day at its latest visit, newest first", async () => {
    const source = fakeHistory([
      {
        title: "A",
        url: "https://a.test/",
        visits: [at(8, 9), at(9, 10), at(9, 14)],
      },
      { title: "B", url: "https://b.test/", visits: [at(9, 12)] },
    ]);
    const page = await loadPage(source, {
      endTime: at(10, 0),
      hiddenOrigin: OWN,
      maxResults: 10,
      text: "",
    });
    expect(page.entries).toEqual([
      {
        day: at(9, 0),
        id: `${at(9, 0)} https://a.test/`,
        time: at(9, 14),
        title: "A",
        url: "https://a.test/",
        visits: [at(9, 10), at(9, 14)],
      },
      {
        day: at(9, 0),
        id: `${at(9, 0)} https://b.test/`,
        time: at(9, 12),
        title: "B",
        url: "https://b.test/",
        visits: [at(9, 12)],
      },
      {
        day: at(8, 0),
        id: `${at(8, 0)} https://a.test/`,
        time: at(8, 9),
        title: "A",
        url: "https://a.test/",
        visits: [at(8, 9)],
      },
    ]);
    expect(page.next).toBeUndefined();
  });

  it("stops a full page at its oldest page's latest visit and continues from there", async () => {
    const source = fakeHistory([
      { title: "A", url: "https://a.test/", visits: [at(7, 9), at(9, 14)] },
      { title: "B", url: "https://b.test/", visits: [at(9, 12)] },
      { title: "C", url: "https://c.test/", visits: [at(8, 12)] },
    ]);
    const first = await loadPage(source, {
      endTime: at(10, 0),
      hiddenOrigin: OWN,
      maxResults: 2,
      text: "",
    });
    expect(first.entries.map((entry) => entry.time)).toEqual([
      at(9, 14),
      at(9, 12),
    ]);
    expect(first.next).toBe(at(9, 12));

    const second = await loadPage(source, {
      endTime: at(9, 12),
      hiddenOrigin: OWN,
      maxResults: 2,
      text: "",
    });
    expect(second.entries.map((entry) => entry.time)).toEqual([
      at(8, 12),
      at(7, 9),
    ]);
    expect(second.next).toBe(at(7, 9));
  });

  it("leaves out the app's own pages", async () => {
    const source = fakeHistory([
      { title: "History", url: `${OWN}history.html`, visits: [at(9, 9)] },
      { title: "A", url: "https://a.test/", visits: [at(9, 8)] },
    ]);
    const page = await loadPage(source, {
      endTime: at(10, 0),
      hiddenOrigin: OWN,
      maxResults: 10,
      text: "",
    });
    expect(page.entries.map((entry) => entry.url)).toEqual(["https://a.test/"]);
  });

  it("searches with the text", async () => {
    const source = fakeHistory([
      { title: "Cats", url: "https://a.test/", visits: [at(9, 9)] },
      { title: "Dogs", url: "https://b.test/", visits: [at(9, 8)] },
    ]);
    const page = await loadPage(source, {
      endTime: at(10, 0),
      hiddenOrigin: OWN,
      maxResults: 10,
      text: "Dogs",
    });
    expect(page.entries.map((entry) => entry.title)).toEqual(["Dogs"]);
  });

  it("throws when a full page has a result with no visit before endTime", async () => {
    const source = {
      getVisits: () => Promise.resolve([at(9, 12)]),
      search: () => Promise.resolve([{ title: "A", url: "https://a.test/" }]),
    };
    await expect(
      loadPage(source, {
        endTime: at(9, 0),
        hiddenOrigin: OWN,
        maxResults: 1,
        text: "",
      }),
    ).rejects.toThrow("https://a.test/ has no visit before");
  });
});

describe(loadSince, () => {
  it("loads pages until one reaches back to the time", async () => {
    const source = fakeHistory([
      { title: "A", url: "https://a.test/", visits: [at(9, 14)] },
      { title: "B", url: "https://b.test/", visits: [at(9, 12), at(9, 13)] },
      { title: "C", url: "https://c.test/", visits: [at(9, 11)] },
      { title: "D", url: "https://d.test/", visits: [at(9, 10)] },
    ]);
    const page = await loadSince(source, at(9, 12), {
      endTime: at(10, 0),
      hiddenOrigin: OWN,
      maxResults: 1,
      text: "",
    });
    expect(page.entries.map((entry) => [entry.url, entry.visits])).toEqual([
      ["https://a.test/", [at(9, 14)]],
      ["https://b.test/", [at(9, 12), at(9, 13)]],
    ]);
    expect(page.next).toBe(at(9, 12));
  });
});
