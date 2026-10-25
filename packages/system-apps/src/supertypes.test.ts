import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { fakeDesktop } from "./fake-desktop";
import { supertypesOf } from "./supertypes";

const DIRS = ["/data", "/share"];

describe("supertypesOf", () => {
  it("lists parents from every directory, nearest first, each once", async () => {
    const system = fakeDesktop({
      "/data/mime/subclasses": "application/x-a application/x-b\n",
      "/share/mime/subclasses": [
        "application/x-a text/x-c",
        "application/x-b text/x-c",
        "text/x-c text/plain",
        "",
      ].join("\n"),
    });

    expect(await supertypesOf(system, DIRS, "application/x-a")).toStrictEqual(
      Ok(["application/x-b", "text/x-c", "text/plain"]),
    );
  });

  it("makes every other text type a text/plain", async () => {
    const system = fakeDesktop({});

    expect(await supertypesOf(system, DIRS, "text/markdown")).toStrictEqual(
      Ok(["text/plain"]),
    );
    expect(await supertypesOf(system, DIRS, "text/plain")).toStrictEqual(
      Ok([]),
    );
  });

  it("fails when the desktop refuses to read", async () => {
    const system = fakeDesktop({
      "/data/mime/subclasses": { fails: SystemErrorKind.Locked },
    });

    expect(await supertypesOf(system, DIRS, "text/plain")).toStrictEqual(
      Err({ kind: SystemErrorKind.Locked, message: "/data/mime/subclasses" }),
    );
  });
});
