import { beforeEach, describe, expect, it } from "bun:test";

import { learnedIcons, learnIcon } from "./learned-icons";

const ICONS_KEY = "bookmark-icons:v1";

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("the icons learned from bookmarks' own pages", () => {
  it("are none on a machine that has seen no page", () => {
    expect(learnedIcons()).toStrictEqual({});
  });

  it("are each bookmark's last learned icon", () => {
    learnIcon("https://cal.example", "https://cdn.example/cal_30.ico");
    learnIcon("https://mail.example", "https://cdn.example/mail.ico");
    learnIcon("https://cal.example", "https://cdn.example/cal_31.ico");

    expect(learnedIcons()).toStrictEqual({
      "https://cal.example": "https://cdn.example/cal_31.ico",
      "https://mail.example": "https://cdn.example/mail.ico",
    });
  });

  it("ignore a value that is not icons", () => {
    globalThis.localStorage.setItem(ICONS_KEY, '["a"]');
    expect(learnedIcons()).toStrictEqual({});
    globalThis.localStorage.setItem(ICONS_KEY, "not json");
    expect(learnedIcons()).toStrictEqual({});
  });
});
