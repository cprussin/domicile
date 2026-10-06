import { describe, expect, it } from "bun:test";

import { crumbsOf, parentOf, shownPath, walked } from "./walk-path";

const HOME = "/home/someone";

describe("parentOf", () => {
  it("is the directory above", () => {
    expect(parentOf("/home/someone/Scratch")).toBe("/home/someone");
    expect(parentOf("/home")).toBe("/");
  });

  it("is nothing above the root", () => {
    expect(parentOf("/")).toBeUndefined();
  });
});

describe("walked", () => {
  const at = (directory: string, typed: string) =>
    walked({ directory, home: HOME, typed });

  // A name with no slash narrows the directory listed; it walks nowhere.
  it("filters without a slash", () => {
    expect(at(HOME, "Scr")).toStrictEqual({ directory: HOME, filter: "Scr" });
  });

  it("walks into what is typed before a slash", () => {
    expect(at(HOME, "Scratch/")).toStrictEqual({
      directory: "/home/someone/Scratch",
      filter: "",
    });
    expect(at(HOME, "Scratch/no")).toStrictEqual({
      directory: "/home/someone/Scratch",
      filter: "no",
    });
  });

  it("walks up with `..`", () => {
    expect(at(HOME, "../")).toStrictEqual({ directory: "/home", filter: "" });
    expect(at("/", "../")).toStrictEqual({ directory: "/", filter: "" });
  });

  it("walks to the root with a leading slash", () => {
    expect(at(HOME, "/")).toStrictEqual({ directory: "/", filter: "" });
    expect(at(HOME, "/etc/ho")).toStrictEqual({
      directory: "/etc",
      filter: "ho",
    });
  });

  it("walks home with a tilde", () => {
    expect(at("/etc", "~/")).toStrictEqual({ directory: HOME, filter: "" });
    expect(at("/etc", "~/Scratch/")).toStrictEqual({
      directory: "/home/someone/Scratch",
      filter: "",
    });
  });
});

describe("shownPath", () => {
  it("says the home as a tilde", () => {
    expect(shownPath(HOME, HOME)).toBe("~");
    expect(shownPath("/home/someone/Scratch/a.png", HOME)).toBe(
      "~/Scratch/a.png",
    );
  });

  it("says anywhere else as it is", () => {
    expect(shownPath("/etc", HOME)).toBe("/etc");
    expect(shownPath("/home/someoneelse", HOME)).toBe("/home/someoneelse");
  });
});

describe("crumbsOf", () => {
  it("starts under the home at the home", () => {
    expect(crumbsOf("/home/someone/Scratch/old", HOME)).toStrictEqual([
      { label: "~", path: HOME },
      { label: "Scratch", path: "/home/someone/Scratch" },
      { label: "old", path: "/home/someone/Scratch/old" },
    ]);
  });

  it("starts anywhere else at the root", () => {
    expect(crumbsOf("/etc/nix", HOME)).toStrictEqual([
      { label: "/", path: "/" },
      { label: "etc", path: "/etc" },
      { label: "nix", path: "/etc/nix" },
    ]);
    expect(crumbsOf("/", HOME)).toStrictEqual([{ label: "/", path: "/" }]);
  });
});
