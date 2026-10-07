import { describe, expect, it } from "bun:test";
import type { PortalHost } from "@domicile-desktop/sdk/portal";
import type { SystemHost } from "@domicile-desktop/sdk/system";
import type { Node } from "@domicile-desktop/system-apps/fake-system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DisplayProvider } from "../Screen/DisplayProvider";
import type { DisplaySource } from "../Screen/display-source";
import { PortalDialogs } from "./PortalDialogs";

/**
 * A desktop that pushes `portal_requests` lines and records answers. Its
 * system calls go to the `fakeSystem` each test passes as `systemOf`.
 */
class FakeHost implements PortalHost, SystemHost {
  readonly answers: [id: number, answer: unknown][] = [];
  readonly #listeners = new Set<(event: MessageEvent<string>) => void>();

  answerPortalRequest(id: number, answer: string): void {
    this.answers.push([id, JSON.parse(answer)]);
  }

  callSystem(): void {
    throw new Error("system calls go to the test's fakeSystem");
  }

  addEventListener(
    type: "portalrequests" | "system",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    if (type === "portalrequests") {
      this.#listeners.add(listener);
    }
  }

  removeEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  push(items: readonly object[]): void {
    const data = JSON.stringify({ items, type: "portal_requests" });
    act(() => {
      for (const listener of this.#listeners) {
        listener(new MessageEvent("portalrequests", { data }));
      }
    });
  }
}

const access = (id: number, body: object = {}) => ({
  app_id: "org.example.App",
  body: {
    body: "It will see you.",
    subtitle: "Example wants the camera",
    title: "Use the camera?",
    ...body,
  },
  id,
  kind: "access",
});

/** An application's desktop entry. */
const entry = (name: string, icon: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${icon}\nIcon=${icon}\n`;

/**
 * A desktop with a document viewer and a browser installed, the browser the
 * default for PDFs, and `tree` besides.
 */
const desktop =
  (tree: Readonly<Record<string, Node>> = {}) =>
  () =>
    fakeSystem(
      {
        "/config/mimeapps.list":
          "[Default Applications]\napplication/pdf=firefox.desktop\n",
        "/share/applications/firefox.desktop": entry("Firefox", "firefox"),
        "/share/applications/org.gnome.Evince.desktop": entry(
          "Document Viewer",
          "evince",
        ),
        "/share/icons/hicolor/48x48/apps/firefox.svg": "<svg/>",
        ...tree,
      },
      () => ({
        code: 0,
        stderr: "",
        stdout:
          "XDG_CONFIG_HOME=/config\0XDG_DATA_HOME=/data\0XDG_DATA_DIRS=/share\0",
      }),
    );

const chooser = (id: number, body: object = {}) => ({
  app_id: "org.example.App",
  body: {
    choices: ["org.gnome.Evince", "firefox"],
    content_type: "application/pdf",
    filename: "report.pdf",
    ...body,
  },
  id,
  kind: "app_chooser",
});

/** A desktop with a small home for the file chooser to list. */
const home = () =>
  desktop({
    "/home/me/Documents/report.pdf": "",
    "/home/me/notes.txt": "",
    "/home/me/photo.png": "",
  });

const fileChooser = (id: number, body: object = {}) => ({
  app_id: "org.example.Editor",
  body: {
    choices: [],
    directory: false,
    files: [],
    filters: [],
    home: "/home/me",
    mode: "open",
    multiple: false,
    title: "Open Notes",
    ...body,
  },
  id,
  kind: "file_chooser",
});

/** Lets the picker's listings resolve. */
const listed = () => act(() => Promise.resolve());

describe(PortalDialogs, () => {
  describe("rendering", () => {
    it("draws nothing while no application asks", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([]);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("asks an access question naming the application", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);

      expect(screen.getByRole("dialog")).toHaveTextContent("Use the camera?");
      expect(screen.getByText("org.example.App asks")).toBeInTheDocument();
      expect(screen.getByText("Example wants the camera")).toBeInTheDocument();
      expect(screen.getByText("It will see you.")).toBeInTheDocument();
    });

    it("uses the labels the application offers", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1, { deny_label: "Never", grant_label: "Sure" })]);

      expect(screen.getByRole("button", { name: "Sure" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Never" })).toBeInTheDocument();
    });

    it("names an application it cannot identify", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([{ ...access(1), app_id: "" }]);

      expect(screen.getByText("An application asks")).toBeInTheDocument();
    });

    it("puts the dialog over the screen it is given", () => {
      const host = new FakeHost();
      render(
        <DisplayProvider source={TWO_SCREENS}>
          <PortalDialogs host={host} screen="right" />
        </DisplayProvider>,
      );
      host.push([access(1)]);

      expect(screen.getByRole("dialog").parentElement?.style.left).toBe(
        "1920px",
      );
    });

    it("offers each choice by name and icon, the default picked", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1)]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Open report.pdf with",
      );
      const firefox = await screen.findByRole("option", { name: "Firefox" });
      expect(firefox).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("option", { name: "Document Viewer" }),
      ).toHaveAttribute("aria-selected", "false");
      expect(firefox.querySelector("img")?.getAttribute("src")).toStartWith(
        "data:image/svg+xml",
      );
    });

    it("picks the last choice over the default", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1, { last_choice: "org.gnome.Evince" })]);

      expect(
        await screen.findByRole("option", { name: "Document Viewer" }),
      ).toHaveAttribute("aria-selected", "true");
    });

    it("names a choice with no desktop entry by its id, and a URI", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([
        chooser(1, {
          choices: ["org.example.Gone"],
          content_type: undefined,
          filename: undefined,
          uri: "https://example.com/",
        }),
      ]);

      expect(
        await screen.findByRole("option", { name: "org.example.Gone" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Open https://example.com/ with",
      );
    });

    it("shows choices the application adds while it is up", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1, { choices: ["org.gnome.Evince"] })]);
      await screen.findByRole("option", { name: "Document Viewer" });
      host.push([chooser(1)]);

      expect(
        await screen.findByRole("option", { name: "Firefox" }),
      ).toBeInTheDocument();
    });

    it("goes away when the request does", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      host.push([]);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("file chooser", () => {
    it("asks for files under the application's title, in its folder", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([
        fileChooser(1, {
          accept_label: "Attach",
          current_folder: "/home/me/Documents",
        }),
      ]);
      await listed();

      expect(
        screen.getByRole("dialog", { name: "Open Notes" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "report.pdf" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Attach" }),
      ).toBeInTheDocument();
    });

    it("answers with the file chosen, the filter and each choice", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([
        fileChooser(1, {
          choices: [
            {
              id: "encoding",
              initial: "utf8",
              label: "Encoding",
              options: [
                { id: "utf8", label: "UTF-8" },
                { id: "latin1", label: "Latin-1" },
              ],
            },
            {
              id: "readonly",
              initial: "false",
              label: "Read only",
              options: [],
            },
          ],
          current_filter: 1,
          filters: [
            { extensions: ["png"], name: "Images" },
            { extensions: ["txt"], name: "Text" },
          ],
        }),
      ]);
      await listed();
      await userEvent.click(
        screen.getByRole("combobox", { name: "Read only" }),
      );
      await userEvent.click(screen.getByRole("option", { name: "Yes" }));
      await userEvent.click(screen.getByRole("combobox", { name: "Encoding" }));
      await userEvent.click(screen.getByRole("option", { name: "Latin-1" }));
      await userEvent.dblClick(
        screen.getByRole("option", { name: "notes.txt" }),
      );

      expect(host.answers).toEqual([
        [
          1,
          {
            choices: { encoding: "latin1", readonly: "true" },
            current_filter: 1,
            kind: "file_chooser",
            paths: ["/home/me/notes.txt"],
          },
        ],
      ]);
    });

    it("opens several files", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([fileChooser(1, { multiple: true })]);
      await listed();

      expect(
        screen.getByRole("listbox", { name: "Contents of ~" }),
      ).toHaveAttribute("aria-multiselectable", "true");
    });

    it("chooses a folder", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([fileChooser(1, { directory: true })]);
      await listed();
      await userEvent.click(screen.getByRole("button", { name: "Choose" }));

      expect(host.answers).toEqual([
        [1, { choices: {}, kind: "file_chooser", paths: ["/home/me"] }],
      ]);
    });

    it("saves under the name suggested", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([fileChooser(1, { current_name: "draft.txt", mode: "save" })]);
      await listed();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(host.answers).toEqual([
        [
          1,
          { choices: {}, kind: "file_chooser", paths: ["/home/me/draft.txt"] },
        ],
      ]);
    });

    it("saves several files into the folder chosen", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([
        fileChooser(1, { files: ["a.txt", "b.txt"], mode: "save_files" }),
      ]);
      await listed();

      expect(screen.getByText("Saves a.txt, b.txt")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(host.answers).toEqual([
        [1, { choices: {}, kind: "file_chooser", paths: ["/home/me"] }],
      ]);
    });

    it("cancels", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={home()} />);
      host.push([fileChooser(1)]);
      await listed();
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Cancel",
        }),
      );

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("goes over the screen of the window that asked", async () => {
      const host = new FakeHost();
      render(
        <DisplayProvider source={TWO_SCREENS}>
          <PortalDialogs
            host={host}
            screen="left"
            screenOf={(appId) => (appId === "app-3" ? "right" : undefined)}
            systemOf={home()}
          />
        </DisplayProvider>,
      );
      host.push([{ ...fileChooser(1), parent_app_id: "app-3" }]);
      await listed();

      expect(screen.getByRole("dialog").parentElement?.style.left).toBe(
        "1920px",
      );
    });
  });

  describe("answers", () => {
    it("allows", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(host.answers).toEqual([[1, { kind: "access" }]]);
    });

    it("denies", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Deny" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("cancels on Escape", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      await userEvent.keyboard("{Escape}");

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("opens the picked application", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await screen.findByRole("option", { name: "Firefox" });
      await userEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(host.answers).toEqual([
        [1, { choice: "firefox", kind: "app_chooser" }],
      ]);
    });

    it("moves the pick with the arrows and opens it with Enter", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await screen.findByRole("option", { name: "Firefox" });
      await userEvent.keyboard("{ArrowUp}{Enter}");

      expect(host.answers).toEqual([
        [1, { choice: "org.gnome.Evince", kind: "app_chooser" }],
      ]);
    });

    it("opens an application double-clicked", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await userEvent.dblClick(
        await screen.findByRole("option", { name: "Document Viewer" }),
      );

      expect(host.answers).toEqual([
        [1, { choice: "org.gnome.Evince", kind: "app_chooser" }],
      ]);
    });

    it("cancels a choice", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await screen.findByRole("option", { name: "Firefox" });
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("leaves an inhibitor alone and asks what comes after it", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} systemOf={desktop()} />);
      host.push([
        {
          app_id: "org.example.Editor",
          body: { what: ["logout"] },
          id: 5,
          kind: "inhibit",
        },
        access(6),
      ]);

      expect(host.answers).toEqual([]);
      expect(screen.getByRole("dialog")).toHaveTextContent("Use the camera?");
    });

    it("refuses a kind it has no dialog for", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([{ app_id: "", body: {}, id: 4, kind: "print" }]);

      expect(host.answers).toEqual([[4, { kind: "refused" }]]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

const TWO_SCREENS = {
  displays: [
    { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
    { name: "right", position: [1920, 0], scale: 1, size: [1920, 1080] },
  ],
  onDisplays: () => () => undefined,
} satisfies DisplaySource;
