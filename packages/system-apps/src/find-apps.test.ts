import { describe, expect, it } from "bun:test";

import type { DesktopEntry } from "./desktop-entry";
import { parseDesktopEntry } from "./desktop-entry";
import { findApps } from "./find-apps";

const OFFERED: readonly DesktopEntry[] = [
  ["Text Editor", ""],
  ["Firefox", "GenericName=Web Browser\nKeywords=internet;www;\n"],
  ["Files", ""],
  ["Terminal Fire Drill", ""],
].map(([name, more], n) =>
  parseDesktopEntry(
    `${n.toString()}.desktop`,
    `[Desktop Entry]\nType=Application\nName=${name ?? ""}\nExec=run\n${more ?? ""}`,
  ).match({
    None: () => {
      throw new Error(`${name ?? ""} is not an application`);
    },
    Some: (entry) => entry,
  }),
);

const names = (found: readonly DesktopEntry[]): string[] =>
  found.map(({ name }) => name);

describe("findApps", () => {
  it("matches every word against a name, generic name or keyword, ignoring case", () => {
    expect(names(findApps(OFFERED, "WEB browser", 10))).toStrictEqual([
      "Firefox",
    ]);
    expect(names(findApps(OFFERED, "www", 10))).toStrictEqual(["Firefox"]);
    expect(findApps(OFFERED, "fire nope", 10)).toStrictEqual([]);
  });

  it("puts names that start with the query first, then sorts by name", () => {
    expect(names(findApps(OFFERED, "fi", 10))).toStrictEqual([
      "Files",
      "Firefox",
      "Terminal Fire Drill",
    ]);
  });

  it("offers no more than the limit", () => {
    expect(names(findApps(OFFERED, "", 2))).toStrictEqual(["Files", "Firefox"]);
  });
});
