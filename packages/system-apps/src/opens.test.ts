import { describe, expect, it } from "bun:test";

import { fakeDesktop } from "./fake-desktop";
import { nothingOpens, opens } from "./opens";

/** A desktop whose `domicile open --which` answers `code` and `stdout`. */
const desktop = (code: number, stdout: string) => {
  const asked: (readonly string[])[] = [];
  const domicile = fakeDesktop({}, (argv) => {
    asked.push(argv);
    return { code, stderr: "", stdout };
  });
  return { asked, domicile };
};

const fail = (error: unknown): never => {
  throw new Error(`expected a value: ${JSON.stringify(error)}`);
};

describe(opens, () => {
  it("is true when domicile open names an app for the file", async () => {
    const { asked, domicile } = desktop(0, "viewer.desktop\n");

    expect((await opens(domicile, "/home/me/a.pdf")).unwrapOrElse(fail)).toBe(
      true,
    );
    expect(asked.map((argv) => [argv[0], argv.at(-1)])).toEqual([
      ["sh", "/home/me/a.pdf"],
    ]);
  });

  it("is false when domicile open finds none", async () => {
    const { domicile } = desktop(1, "");

    expect((await opens(domicile, "/home/me/a.kra")).unwrapOrElse(fail)).toBe(
      false,
    );
  });

  it("is false when domicile open names nothing", async () => {
    const { domicile } = desktop(0, "\n");

    expect((await opens(domicile, "/home/me/a.kra")).unwrapOrElse(fail)).toBe(
      false,
    );
  });
});

describe(nothingOpens, () => {
  it("names the kind of file by its extension", () => {
    expect(nothingOpens("Art/Drawing.KRA")).toBe(
      "No app on this computer can open .kra files.",
    );
  });

  it("says this file for one with no extension", () => {
    expect(nothingOpens("NOTES")).toBe(
      "No app on this computer can open this file.",
    );
    expect(nothingOpens(".bashrc")).toBe(
      "No app on this computer can open this file.",
    );
  });
});
