import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { writeEnded } from "./write-ended";

describe(writeEnded, () => {
  it("writes an empty file at the path", async () => {
    const written: [string, string | Uint8Array][] = [];
    await writeEnded(new FakeDomicileHost().host, "/run/splash/ended", () => ({
      write: (path, data) => {
        written.push([path, data]);
        return Promise.resolve(Ok("written" as const));
      },
    }));
    expect(written).toEqual([["/run/splash/ended", ""]]);
  });

  it("rejects when the compositor refuses", async () => {
    await expect(
      writeEnded(new FakeDomicileHost().host, "/run/splash/ended", () => ({
        write: () =>
          Promise.resolve(
            Err({ kind: SystemErrorKind.Locked, message: "locked" }),
          ),
      })),
    ).rejects.toThrow("could not write /run/splash/ended");
  });
});
