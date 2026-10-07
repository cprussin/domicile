import { describe, expect, it } from "bun:test";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppChooser } from "./AppChooser";

const entry = (name: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=app\n`;

/** A desktop with an editor and a viewer installed, the viewer the default. */
const desktop = () =>
  fakeSystem(
    {
      "/config/mimeapps.list":
        "[Default Applications]\ntext/plain=viewer.desktop\n",
      "/share/applications/editor.desktop": entry("Editor"),
      "/share/applications/viewer.desktop": entry("Viewer"),
    },
    () => ({
      code: 0,
      stderr: "",
      stdout: "XDG_CONFIG_HOME=/config\0XDG_DATA_DIRS=/share\0",
    }),
  );

/** What the chooser answered: an application, or `undefined` on cancel. */
const chosen = (description?: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    render(
      <AppChooser
        choices={["editor", "viewer"]}
        contentType="text/plain"
        description={description}
        onCancel={() => {
          resolve(undefined);
        }}
        onChoose={resolve}
        screen={undefined}
        system={desktop()}
        title="Open notes.txt with"
      />,
    );
  });

describe("AppChooser", () => {
  it("names what it opens and why it asks", async () => {
    const answer = chosen("Mail asks");

    expect(
      await screen.findByRole("dialog", { name: "Open notes.txt with" }),
    ).toHaveTextContent("Mail asks");
    await userEvent.keyboard("{Escape}");
    expect(await answer).toBeUndefined();
  });

  it("opens the type's default with Open", async () => {
    const answer = chosen();
    await screen.findByRole("option", { name: "Viewer", selected: true });
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await answer).toBe("viewer");
  });

  it("opens another application picked", async () => {
    const answer = chosen();
    await userEvent.dblClick(
      await screen.findByRole("option", { name: "Editor" }),
    );

    expect(await answer).toBe("editor");
  });

  it("cancels", async () => {
    const answer = chosen();
    await screen.findByRole("option", { name: "Editor" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await answer).toBeUndefined();
  });
});
