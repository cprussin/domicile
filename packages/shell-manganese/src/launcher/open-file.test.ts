import { describe, expect, it } from "bun:test";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";

import { openCommand } from "./open-command";
import { openFileCommand } from "./open-file";

/** A desktop with an editor that opens text, the default set in `defaults`. */
const desktop = (defaults: string) =>
  fakeSystem(
    {
      "/config/domicile-mimeapps.list": `[Default Applications]\n${defaults}\n`,
      "/share/applications/editor.desktop":
        "[Desktop Entry]\nType=Application\nName=Editor\nExec=editor --open=%f\nMimeType=text/plain;\n",
      "/share/applications/pager.desktop":
        "[Desktop Entry]\nType=Application\nName=Pager\nExec=pager %u\n",
      "/share/mime/globs2": "50:text/plain:*.txt\n",
      "Notes/today.org": "",
      "Notes/today.txt": "",
    },
    () => ({
      code: 0,
      stderr: "",
      stdout:
        "HOME=/home/me\0XDG_CONFIG_HOME=/config\0XDG_CURRENT_DESKTOP=Domicile\0XDG_DATA_DIRS=/share\0",
    }),
  );

describe("openFileCommand", () => {
  it("runs the type's default with the file", async () => {
    expect(
      await openFileCommand(
        desktop("text/plain=pager.desktop"),
        "Notes/today.txt",
      ),
    ).toStrictEqual(["pager", "/home/me/Notes/today.txt"]);
  });

  it("runs an application that opens the type when none is the default", async () => {
    expect(await openFileCommand(desktop(""), "Notes/today.txt")).toStrictEqual(
      ["editor", "--open=/home/me/Notes/today.txt"],
    );
  });

  it("leaves a type nothing opens to xdg-open", async () => {
    expect(await openFileCommand(desktop(""), "Notes/today.org")).toStrictEqual(
      openCommand("Notes/today.org"),
    );
  });
});
