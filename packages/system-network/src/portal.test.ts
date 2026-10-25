import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { Ran, SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { checkPortal, PORTAL_PROBE } from "./portal";

/** Processes whose `curl` exits with `code` and writes `stdout`. */
const curl = (code: number, stdout: string) => ({
  argv: [] as readonly string[],
  run(argv: readonly string[]): Promise<Result<Ran, SystemError>> {
    this.argv = argv;
    const ran: Ran = { code, signal: undefined, stderr: "", stdout };
    return Promise.resolve(Ok(ran));
  },
});

describe("checkPortal", () => {
  it("asks for the probe without following its redirect", async () => {
    const system = curl(0, "204 ");
    await checkPortal({ processes: system });
    expect(system.argv[0]).toBe("curl");
    expect(system.argv).not.toContain("--location");
    expect(system.argv.at(-1)).toBe(PORTAL_PROBE);
  });

  it("finds no portal when the probe answers 204", async () => {
    expect(await checkPortal({ processes: curl(0, "204 ") })).toStrictEqual(
      Ok(None()),
    );
  });

  it("signs in where a portal redirects the probe", async () => {
    expect(
      await checkPortal({
        processes: curl(0, "302 http://10.0.0.1/login?orig=gstatic"),
      }),
    ).toStrictEqual(Ok(Some("http://10.0.0.1/login?orig=gstatic")));
  });

  it("signs in at the probe when a portal answers it with a page", async () => {
    expect(await checkPortal({ processes: curl(0, "200 ") })).toStrictEqual(
      Ok(Some(PORTAL_PROBE)),
    );
  });

  it("fails when curl gets no answer", async () => {
    // curl's code for a host it could not resolve.
    expect(await checkPortal({ processes: curl(6, "000 ") })).toStrictEqual(
      Err({
        kind: SystemErrorKind.Other,
        message: "curl exited 6 asking for the portal probe",
      }),
    );
  });
});
