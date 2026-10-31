import { describe, expect, test } from "bun:test";
import type { Metadata } from "next";
import { metadata as manganese } from "./manganese/page";
import { metadata as domicile } from "./page";

describe.each<[string, Metadata, string]>([
  ["the Domicile page", domicile, "/"],
  ["the manganese page", manganese, "/manganese"],
])("%s", (_, metadata, path) => {
  test("is its own canonical page, shared as a large card", () => {
    expect(metadata.alternates?.canonical).toBe(path);
    expect(metadata.openGraph?.url).toBe(path);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  test("shares the same title and description it shows in search", () => {
    const shown: unknown = metadata.title;
    const sharedDescription: unknown = metadata.openGraph?.description;
    expect(shown).toEqual({ absolute: metadata.openGraph?.title });
    expect(sharedDescription).toBe(metadata.description);
  });
});
