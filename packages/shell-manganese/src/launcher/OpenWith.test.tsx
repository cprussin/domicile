import { describe, expect, it } from "bun:test";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OpenWith } from "./OpenWith";

const app = (name: string, exec: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\nMimeType=text/plain;\n`;

/** A desktop with two text applications, the pager the default. */
const desktop = () =>
  fakeSystem(
    {
      "/config/mimeapps.list":
        "[Default Applications]\ntext/plain=pager.desktop\n",
      "/share/applications/editor.desktop": app("Editor", "editor %f"),
      "/share/applications/pager.desktop": app("Pager", "pager %u"),
      "/share/mime/globs2": "50:text/plain:*.txt\n",
      "Notes/today.txt": "",
    },
    () => ({
      code: 0,
      stderr: "",
      stdout: "HOME=/home/me\0XDG_CONFIG_HOME=/config\0XDG_DATA_DIRS=/share\0",
    }),
  );

/** What the dialog answered: an argv, or `undefined` when closed. */
const answered = (): Promise<readonly string[] | undefined> =>
  new Promise((resolve) => {
    render(
      <OpenWith
        onClose={() => {
          resolve(undefined);
        }}
        onOpen={resolve}
        path="Notes/today.txt"
        screen={undefined}
        system={desktop()}
      />,
    );
  });

describe("OpenWith", () => {
  it("offers what opens the file, the default picked", async () => {
    const answer = answered();
    await screen.findByRole("option", { name: "Pager", selected: true });

    expect(
      screen.getByRole("dialog", { name: "Open today.txt with" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await answer).toStrictEqual(["pager", "/home/me/Notes/today.txt"]);
  });

  it("runs the application picked with the file", async () => {
    const answer = answered();
    await userEvent.dblClick(
      await screen.findByRole("option", { name: "Editor" }),
    );

    expect(await answer).toStrictEqual(["editor", "/home/me/Notes/today.txt"]);
  });

  it("closes on Cancel", async () => {
    const answer = answered();
    await screen.findByRole("option", { name: "Editor" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await answer).toBeUndefined();
  });
});
