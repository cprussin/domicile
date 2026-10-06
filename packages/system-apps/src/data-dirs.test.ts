import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import { dataDirs } from "./data-dirs";
import { fakeSystem } from "./fake-system";

/** A desktop whose environment is `variables`. */
const desktop = (variables: Readonly<Record<string, string>>) =>
  fakeSystem({}, (argv) => {
    expect(argv).toStrictEqual(["env", "-0"]);
    return {
      code: 0,
      stderr: "",
      stdout: Object.entries(variables)
        .map(([name, value]) => `${name}=${value}\0`)
        .join(""),
    };
  });

describe("dataDirs", () => {
  it("puts the data home before the data dirs", async () => {
    expect(
      await dataDirs(
        desktop({
          OTHER: "line one\nXDG_DATA_HOME=/not/this",
          XDG_DATA_DIRS: "/a/share:/b/share",
          XDG_DATA_HOME: "/data/home",
        }),
      ),
    ).toStrictEqual(Ok(["/data/home", "/a/share", "/b/share"]));
  });

  it("reads unset or empty variables as the spec's defaults, under the home", async () => {
    const defaults: Result<string[], SystemError> = Ok([
      ".local/share",
      "/usr/local/share",
      "/usr/share",
    ]);
    expect(await dataDirs(desktop({}))).toStrictEqual(defaults);
    expect(
      await dataDirs(desktop({ XDG_DATA_DIRS: "", XDG_DATA_HOME: "" })),
    ).toStrictEqual(defaults);
  });

  it("throws when env fails", async () => {
    const broken = fakeSystem({}, () => ({
      code: 1,
      stderr: "no",
      stdout: "",
    }));

    await expect(dataDirs(broken)).rejects.toThrow("env failed: no");
  });
});
