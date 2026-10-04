import { describe, expect, it } from "bun:test";

import type { DomicileWindow } from "./domicile-host";
import { surfaceSizeOf, windowOf } from "./windows";

/** A window as the engine lists it, with nothing said about it yet. */
const described = (
  appId: string,
  fields: Partial<DomicileWindow> = {},
): DomicileWindow => ({
  appId,
  cursor: "default",
  grab: false,
  height: null,
  maxHeight: null,
  maxWidth: null,
  minHeight: null,
  minWidth: null,
  parent: null,
  title: "",
  width: null,
  x: null,
  y: null,
  ...fields,
});

describe("windowOf", () => {
  const windows = [
    described("term"),
    described("menu", { parent: "term" }),
    described("submenu", { parent: "menu" }),
  ];

  it("is a window's own id", () => {
    expect(windowOf(windows, "term")).toBe("term");
  });

  it("is the window under a popup, however deep", () => {
    expect(windowOf(windows, "submenu")).toBe("term");
  });

  it("is the id itself for one the engine has not listed", () => {
    expect(windowOf(windows, "gone")).toBe("gone");
  });
});

describe("surfaceSizeOf", () => {
  it("is what the client drew", () => {
    expect(
      surfaceSizeOf([described("term", { height: 480, width: 640 })], "term"),
    ).toStrictEqual([640, 480]);
  });

  it("is nothing before the client draws, or for one not listed", () => {
    expect(surfaceSizeOf([described("term")], "term")).toBeUndefined();
    expect(surfaceSizeOf([], "term")).toBeUndefined();
  });
});
