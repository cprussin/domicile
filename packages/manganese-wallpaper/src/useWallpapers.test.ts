import { describe, expect, it, spyOn } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { Files } from "@domicile-desktop/sdk/desktop/files";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";
import { act, renderHook } from "@testing-library/react";

import { useWallpapers } from "./useWallpapers";

const FOLDER = [
  { fileType: FileType.File, name: "b.png" },
  { fileType: FileType.File, name: "notes.txt" },
  { fileType: FileType.Directory, name: "old.jpg" },
  { fileType: FileType.Symlink, name: "a.JPG" },
  { fileType: FileType.File, name: "c.webp" },
];

const NOT_FOUND = { kind: SystemErrorKind.NotFound, message: "gone" };

// Created outside render, since a new one reads again.
const files: Pick<Files, "readDir" | "stat"> = {
  readDir: (path) =>
    Promise.resolve(path === "Walls" ? Ok(FOLDER) : Err(NOT_FOUND)),
  stat: (path) =>
    Promise.resolve(
      path === "Walls" || path === "/gone"
        ? Ok({
            fileType: FileType.Directory,
            modifiedMs: undefined,
            realPath: undefined,
            size: 0,
          })
        : Ok({
            fileType: FileType.File,
            modifiedMs: undefined,
            realPath: undefined,
            size: 1,
          }),
    ),
};

describe("useWallpapers", () => {
  it("lists a folder's images by name, from the home for `~/`", async () => {
    const wallpapers = {
      dark: ["~/Walls"],
      light: ["https://example.com/a.jpg"],
    };
    const { result } = renderHook(() => useWallpapers(files, wallpapers));
    await act(() => Promise.resolve());

    expect(result.current).toEqual({
      dark: ["Walls/a.JPG", "Walls/b.png", "Walls/c.webp"],
      light: ["https://example.com/a.jpg"],
    });
  });

  it("keeps web addresses and image files, in the config's order", async () => {
    const wallpapers = {
      dark: ["https://example.com/a.jpg", "/srv/night.jpg"],
      light: ["/srv/day.jpg"],
    };
    const { result } = renderHook(() => useWallpapers(files, wallpapers));
    await act(() => Promise.resolve());

    expect(result.current).toEqual(wallpapers);
  });

  it("is nothing until the folders are read", async () => {
    const wallpapers = { dark: ["~/Walls"], light: ["/srv/day.jpg"] };
    const { result } = renderHook(() => useWallpapers(files, wallpapers));

    expect(result.current).toBeUndefined();
    await act(() => Promise.resolve());
  });

  it("drops a folder it cannot read, and says why", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {
      /* asserted below */
    });
    const wallpapers = {
      dark: ["/gone", "/srv/night.jpg"],
      light: ["/srv/day.jpg"],
    };
    const { result } = renderHook(() => useWallpapers(files, wallpapers));
    await act(() => Promise.resolve());

    expect(result.current?.dark).toEqual(["/srv/night.jpg"]);
    expect(logged).toHaveBeenCalledWith(
      "cannot list the wallpaper folder /gone",
      NOT_FOUND,
    );
    logged.mockRestore();
  });
});
