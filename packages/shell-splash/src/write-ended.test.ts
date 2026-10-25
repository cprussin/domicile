import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { writeEnded } from "./write-ended";

describe(writeEnded, () => {
  it("writes an empty file at the path", async () => {
    const written: [string, string | Uint8Array][] = [];
    await writeEnded(
      {
        files: {
          write: (path, data) => {
            written.push([path, data]);
            return Promise.resolve(Ok("written" as const));
          },
        },
      },
      "/run/splash/ended",
    );
    expect(written).toEqual([["/run/splash/ended", ""]]);
  });

  it("rejects when the compositor refuses", async () => {
    await expect(
      writeEnded(
        {
          files: {
            write: () =>
              Promise.resolve(
                Err({ kind: SystemErrorKind.Locked, message: "locked" }),
              ),
          },
        },
        "/run/splash/ended",
      ),
    ).rejects.toThrow("could not write /run/splash/ended");
  });
});
