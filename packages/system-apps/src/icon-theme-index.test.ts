import { describe, expect, it } from "bun:test";

import {
  DirectoryType,
  parseIndexTheme,
  sizeDistance,
} from "./icon-theme-index";

describe("parseIndexTheme", () => {
  it("reads directories with the spec's defaults, skipping those without a size", () => {
    expect(
      parseIndexTheme(
        [
          "[Icon Theme]",
          "Directories=22x22/panel,48x48/legacy,broken",
          "[22x22/panel]",
          "Size=22",
          "Context=Panel",
          "[48x48/legacy]",
          "Size=48",
          "[broken]",
          "Context=Status",
        ].join("\n"),
      ),
    ).toStrictEqual({
      directories: [
        {
          context: "panel",
          maxSize: 22,
          minSize: 22,
          path: "22x22/panel",
          size: 22,
          threshold: 2,
          type: DirectoryType.Threshold,
        },
        {
          context: undefined,
          maxSize: 48,
          minSize: 48,
          path: "48x48/legacy",
          size: 48,
          threshold: 2,
          type: DirectoryType.Threshold,
        },
      ],
      inherits: [],
    });
  });
});

describe("sizeDistance", () => {
  it("measures a threshold directory from its size either side of the threshold", () => {
    const [directory] = parseIndexTheme(
      "[Icon Theme]\nDirectories=24\n[24]\nSize=24\nThreshold=4\n",
    ).directories;
    if (directory === undefined) {
      throw new Error("no directory parsed");
    } else {
      expect(
        [16, 20, 28, 32].map((size) => sizeDistance(directory, size)),
      ).toStrictEqual([8, 0, 0, 8]);
    }
  });
});
