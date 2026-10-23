import { describe, expect, test } from "bun:test";

import { captured } from "./captured";

const having =
  (...files: string[]) =>
  (file: string) =>
    files.includes(file);

describe("captured", () => {
  test("a video with its picture as the poster", () => {
    expect(
      captured("hero", having("hero.webm", "hero.mp4", "hero.png")),
    ).toEqual({
      kind: "video",
      mp4: "/media/hero.mp4",
      poster: "/media/hero.png",
      webm: "/media/hero.webm",
    });
  });

  test("a video needs both formats", () => {
    expect(captured("hero", having("hero.webm", "hero.png"))).toEqual({
      kind: "picture",
      png: "/media/hero.png",
    });
  });

  test("nothing captured yet", () => {
    expect(captured("hero", having())).toEqual({ kind: "missing" });
  });
});
