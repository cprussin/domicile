import { describe, expect, it } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App";
import type { InstalledExtension } from "./extensions";
import type { FakeHostState } from "./fake-host";
import { fakeExtensions, fakeHost } from "./fake-host";
import type { SettingsFiles } from "./host";

const CONFIG_PATH = "/home/me/.config/domicile/domicile.json";
const SHELL_PATH = "/home/me/.config/domicile/shell.ts";
const UBLOCK = "ddkjiahejlhfcafbddmgiahcphecmpfh";

const files = (
  config: Record<string, unknown>,
  writable = true,
): SettingsFiles => ({
  config: {
    path: CONFIG_PATH,
    text: JSON.stringify(config),
    writable,
  },
  evaluated: undefined,
  shell: {
    path: SHELL_PATH,
    text: "export const Shell = runManganese();\n",
    writable,
  },
});

const SITES = {
  defaults: {
    camera: "ask",
    clipboard: "ask",
    location: "ask",
    microphone: "ask",
    midi: "ask",
    notifications: "allow",
  },
  sites: [
    { origin: "https://meet.example", permission: "camera", setting: "allow" },
    {
      origin: "https://meet.example",
      permission: "microphone",
      setting: "allow",
    },
    {
      origin: "https://maps.example",
      permission: "location",
      setting: "block",
    },
  ],
} as const satisfies FakeHostState["sites"];

const INSTALLED: InstalledExtension[] = [
  {
    description: "An efficient content blocker.",
    enabled: true,
    id: UBLOCK,
    name: "uBlock Origin Lite",
    optionsUrl: `chrome-extension://${UBLOCK}/dashboard.html`,
    version: "2025.1",
  },
];

/** The app over a fake host with `config`, opened on `page`. */
const renderApp = async (
  page: string,
  {
    config = {},
    configExtensions = [],
    refuse,
    writable = true,
  }: {
    config?: Record<string, unknown>;
    configExtensions?: string[];
    refuse?: string;
    writable?: boolean;
  } = {},
) => {
  const host = fakeHost({
    configExtensions,
    files: files(config, writable),
    refuse,
    sites: structuredClone(SITES),
  });
  const extensions = fakeExtensions(structuredClone(INSTALLED));
  const user = userEvent.setup();
  render(<App extensions={extensions.extensions} host={host.host} />);
  await user.click(await screen.findByRole("button", { name: page }));
  await screen.findByRole("heading", { level: 1, name: page });
  return { extensions, host, user };
};

/** The config the app last wrote. */
const written = (writes: { file: string; text: string }[]) => {
  const last = writes.at(-1);
  expect(last?.file).toBe("config");
  return JSON.parse(last?.text ?? "");
};

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  option: string,
) => {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
};

describe(App, () => {
  describe("the config", () => {
    it("writes a choice as soon as it is made, keeping the rest", async () => {
      const { host, user } = await renderApp("Appearance", {
        config: { idle: { blank_after_seconds: 60 }, shell: "./shell.ts" },
      });
      await choose(user, "Theme", "Light");
      await waitFor(() => {
        expect(written(host.writes)).toEqual({
          idle: { blank_after_seconds: 60 },
          shell: "./shell.ts",
          theme: { mode: "light" },
        });
      });
    });

    it("shows a read-only config's values and says why it cannot change", async () => {
      await renderApp("Appearance", {
        config: { theme: { mode: "light" } },
        writable: false,
      });
      expect(
        screen.getByText(
          `${CONFIG_PATH} is read-only. Change it where it is made, such as your home-manager config.`,
        ),
      ).toBeInTheDocument();
      const theme = screen.getByRole("combobox", { name: "Theme" });
      expect(theme).toHaveTextContent("Light");
      expect(theme).toBeDisabled();
    });

    it("says why the desktop refused a change", async () => {
      const { user } = await renderApp("Appearance", {
        refuse: "the compositor would refuse this: theme.mode",
      });
      await choose(user, "Theme", "Light");
      expect(
        await screen.findByText("the compositor would refuse this: theme.mode"),
      ).toBeInTheDocument();
    });

    it("shows an edit made elsewhere", async () => {
      const { host } = await renderApp("Appearance");
      host.state.files = files({ theme: { mode: "light" } });
      host.change();
      await waitFor(() => {
        expect(
          screen.getByRole("combobox", { name: "Theme" }),
        ).toHaveTextContent("Light");
      });
    });
  });

  describe("pages", () => {
    it("sets the keyboard layout when the field is left", async () => {
      const { host, user } = await renderApp("Keyboard");
      const layout = screen.getByRole("textbox", { name: "Layout" });
      await user.clear(layout);
      await user.type(layout, "de");
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).input.keyboard.xkb_layout).toBe("de");
      });
    });

    it("adds an xkb option", async () => {
      const { host, user } = await renderApp("Keyboard");
      await user.type(
        screen.getByRole("textbox", { name: "Add an option" }),
        "caps:escape",
      );
      await user.click(screen.getByRole("button", { name: "Add option" }));
      await waitFor(() => {
        expect(written(host.writes).input.keyboard.xkb_options).toEqual([
          "caps:escape",
        ]);
      });
    });

    it("blanks the screens after a time, and never once it is cleared", async () => {
      const { host, user } = await renderApp("Power & lock", {
        config: { idle: { blank_after_seconds: 300 } },
      });
      const after = screen.getByRole("textbox", {
        name: "Blank the screens after (seconds)",
      });
      await user.clear(after);
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes)).toEqual({});
      });
    });

    it("unlocks with the user's password through PAM", async () => {
      const { host, user } = await renderApp("Power & lock");
      await choose(user, "Unlock with", "Your password");
      await user.type(
        screen.getByRole("textbox", { name: "PAM service" }),
        "domicile",
      );
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).lock).toEqual({ pam_service: "domicile" });
      });
    });

    it("asks apps not to use the camera", async () => {
      const { host, user } = await renderApp("Privacy");
      await user.click(
        screen.getByRole("switch", { name: "Ask apps not to use the camera" }),
      );
      await waitFor(() => {
        expect(written(host.writes).lockdown).toEqual({ disable_camera: true });
      });
    });

    it("lists what the file search leaves out, starting from the default", async () => {
      const { host, user } = await renderApp("Launcher");
      await user.type(
        screen.getByRole("textbox", { name: "Add a pattern" }),
        "Downloads",
      );
      await user.click(screen.getByRole("button", { name: "Add pattern" }));
      await waitFor(() => {
        expect(written(host.writes).files.omit).toEqual(["**/.*", "Downloads"]);
      });
    });

    it("edits a startup command as one line", async () => {
      const { host, user } = await renderApp("Startup", {
        config: { startup: { commands: [["emacs", "--daemon"]] } },
      });
      const command = screen.getByRole("textbox", { name: "Command 1" });
      expect(command).toHaveValue("emacs --daemon");
      await user.clear(command);
      await user.type(command, `sh -c "sleep 1; mako"`);
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).startup.commands).toEqual([
          ["sh", "-c", "sleep 1; mako"],
        ]);
      });
    });

    it("sets the scale of a display in a profile", async () => {
      const { host, user } = await renderApp("Displays", {
        config: {
          output: {
            profiles: [{ displays: [{ display: "drm-1" }], name: "laptop" }],
          },
        },
      });
      const scale = screen.getByRole("textbox", { name: "drm-1 scale" });
      await user.clear(scale);
      await user.type(scale, "1.5");
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).output.profiles).toEqual([
          { displays: [{ display: "drm-1", scale: 1.5 }], name: "laptop" },
        ]);
      });
    });
  });

  describe("extensions", () => {
    it("turns an extension off", async () => {
      const { extensions, user } = await renderApp("Extensions");
      await user.click(
        await screen.findByRole("switch", { name: "uBlock Origin Lite" }),
      );
      await waitFor(() => {
        expect(extensions.installed[0]?.enabled).toBe(false);
      });
    });

    it("opens an extension's options", async () => {
      const { extensions, user } = await renderApp("Extensions");
      await user.click(
        await screen.findByRole("button", {
          name: "Options for uBlock Origin Lite",
        }),
      );
      expect(extensions.opened).toEqual([
        `chrome-extension://${UBLOCK}/dashboard.html`,
      ]);
    });

    it("installs from a Web Store address by adding it to the config", async () => {
      const { host, user } = await renderApp("Extensions");
      await user.type(
        screen.getByRole("textbox", { name: "Web Store address or id" }),
        `https://chromewebstore.google.com/detail/x/${"b".repeat(32)}`,
      );
      await user.click(screen.getByRole("button", { name: "Install" }));
      await waitFor(() => {
        expect(written(host.writes).extensions.web_store).toEqual([
          "b".repeat(32),
        ]);
      });
    });

    it("uninstalls an extension the config installed", async () => {
      const { host, user } = await renderApp("Extensions", {
        config: { extensions: { web_store: [UBLOCK] } },
      });
      await user.click(
        await screen.findByRole("button", {
          name: "Uninstall uBlock Origin Lite",
        }),
      );
      await waitFor(() => {
        expect(written(host.writes)).toEqual({});
      });
    });
  });

  describe("unpacked and uninstalled through the engine", () => {
    it("loads an unpacked folder", async () => {
      const { host, user } = await renderApp("Extensions", {
        writable: false,
      });
      await user.type(
        screen.getByRole("textbox", { name: "Unpacked extension folder" }),
        "~/src/my-extension",
      );
      await user.click(screen.getByRole("button", { name: "Load" }));
      await waitFor(() => {
        expect(host.loaded).toEqual(["~/src/my-extension"]);
      });
    });

    it("uninstalls an extension the config did not install", async () => {
      const { host, user } = await renderApp("Extensions");
      await user.click(
        await screen.findByRole("button", {
          name: "Uninstall uBlock Origin Lite",
        }),
      );
      await waitFor(() => {
        expect(host.uninstalled).toEqual([UBLOCK]);
      });
    });

    it("leaves an extension a read-only config installed", async () => {
      await renderApp("Extensions", {
        config: { extensions: { web_store: [UBLOCK] } },
        configExtensions: [UBLOCK],
        writable: false,
      });
      expect(
        await screen.findByRole("switch", { name: "uBlock Origin Lite" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Uninstall uBlock Origin Lite" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("site permissions", () => {
    it("lists the sites with a permission and changes one", async () => {
      const { host, user } = await renderApp("Site permissions");
      await user.click(await screen.findByRole("button", { name: /^Camera/ }));
      await choose(user, "meet.example", "Block");
      await waitFor(() => {
        expect(host.state.sites.sites).toContainEqual({
          origin: "https://meet.example",
          permission: "camera",
          setting: "block",
        });
      });
    });

    it("lists each site's permissions", async () => {
      const { user } = await renderApp("Site permissions");
      await user.click(screen.getByRole("tab", { name: "By site" }));
      await user.click(
        await screen.findByRole("button", { name: /^meet\.example/ }),
      );
      const detail = await screen.findByRole("group", {
        name: "meet.example",
      });
      expect(
        within(detail).getByRole("combobox", { name: "Microphone" }),
      ).toHaveTextContent("Allow");
      expect(
        within(detail).getByRole("combobox", { name: "Notifications" }),
      ).toHaveTextContent("Allow");
    });

    it("removes a site's own settings", async () => {
      const { host, user } = await renderApp("Site permissions");
      await user.click(screen.getByRole("tab", { name: "By site" }));
      await user.click(
        await screen.findByRole("button", { name: /^meet\.example/ }),
      );
      await user.click(
        await screen.findByRole("button", { name: "Remove site" }),
      );
      await waitFor(() => {
        expect(host.state.sites.sites).toEqual([SITES.sites[2]]);
      });
      expect(
        await screen.findByRole("button", { name: /^maps\.example/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^meet\.example/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("code", () => {
    it("saves an edit to the shell", async () => {
      const { host, user } = await renderApp("Code");
      await user.click(screen.getByRole("tab", { name: "Shell" }));
      const editor = await screen.findByRole("textbox", { name: SHELL_PATH });
      await user.type(editor, "// mine");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => {
        expect(host.writes.at(-1)).toEqual({
          file: "shell",
          text: "export const Shell = runManganese();\n// mine",
        });
      });
    });

    it("cannot edit a read-only file", async () => {
      await renderApp("Code", { writable: false });
      expect(
        screen.getByRole("textbox", { name: CONFIG_PATH }),
      ).toHaveAttribute("readonly");
      expect(
        screen.queryByRole("button", { name: "Save" }),
      ).not.toBeInTheDocument();
    });
  });
});
