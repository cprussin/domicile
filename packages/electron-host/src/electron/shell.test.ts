import { describe, expect, it } from "bun:test";

import { createShell } from "./shell";

/** A shell whose commands answer `code` and `output`, recording each. */
const setUp = (code = 0, output = "") => {
  const ran: (readonly string[])[] = [];
  const shell = createShell((command) => {
    ran.push(command);
    return Promise.resolve({ code, output });
  });
  return { ran, shell };
};

describe(createShell, () => {
  it("opens a link with domicile open", async () => {
    const { ran, shell } = setUp();

    await shell.openExternal("https://claude.ai/", { activate: true });

    expect(ran).toEqual([["domicile", "open", "https://claude.ai/"]]);
  });

  it("fails to open a link domicile open could not, with why", () => {
    const { shell } = setUp(1, "no app opens zzz: links\n");

    expect(shell.openExternal("zzz://x")).rejects.toThrow(
      "couldn't open zzz://x: no app opens zzz: links",
    );
  });

  it("opens a file with its default app, answering an empty string", async () => {
    const { ran, shell } = setUp();

    expect(await shell.openPath("/home/me/report.pdf")).toBe("");
    expect(ran).toEqual([["domicile", "open", "/home/me/report.pdf"]]);
  });

  it("answers why it could not open a file, as Electron's openPath does", async () => {
    const { shell } = setUp(2, "");

    expect(await shell.openPath("/nope")).toBe(
      "couldn't open /nope: domicile open exited with 2",
    );
  });

  it("shows an item by opening the folder it is in", async () => {
    const { ran, shell } = setUp();

    shell.showItemInFolder("/home/me/Downloads/claude.zip");
    await Promise.resolve();

    expect(ran).toEqual([["domicile", "open", "/home/me/Downloads"]]);
  });
});
