import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App";
import { hostExtensions } from "./extensions";
import type { FakeHostState } from "./fake-host";
import { fakeHost } from "./fake-host";
import type { InstalledExtension, SettingsFiles } from "./host";

const CONFIG_PATH = "/home/me/.config/domicile/domicile.json";
const SHELL_PATH = "/home/me/.config/domicile/shell.ts";
const UBLOCK = "ddkjiahejlhfcafbddmgiahcphecmpfh";

// Each test drives the whole app through user-event. CI runs every turbo task
// at once, and under that load the first test, which pays the warm-up, and the
// Select tests pass bun's 5s default.
setDefaultTimeout(15_000);

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
    {
      origin: `chrome-extension://${UBLOCK}`,
      permission: "notifications",
      setting: "block",
    },
  ],
} as const satisfies FakeHostState["sites"];

const MEDIA = {
  cameras: [
    { id: "/dev/video0", name: "Integrated Camera" },
    { id: "/dev/video2", name: "USB Camera" },
  ],
  microphones: [{ id: "default", name: "Default" }],
} as const satisfies FakeHostState["media"];

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
    chosen = "/home/me/src/my-extension",
    config = {},
    configExtensions = [],
    refuse,
    writable = true,
  }: {
    /** The folder the picker returns; `null` for a canceled picker. */
    chosen?: string | null;
    config?: Record<string, unknown>;
    configExtensions?: string[];
    refuse?: string;
    writable?: boolean;
  } = {},
) => {
  const host = fakeHost({
    chosen: chosen ?? undefined,
    configExtensions,
    files: files(config, writable),
    installed: structuredClone(INSTALLED),
    media: structuredClone(MEDIA),
    refuse,
    sites: structuredClone(SITES),
  });
  const user = userEvent.setup();
  render(<App extensions={hostExtensions(host.host)} host={host.host} />);
  await user.click(await screen.findByRole("button", { name: page }));
  await screen.findByRole("heading", { level: 1, name: page });
  return { host, user };
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

    it("locks after a time of its own, and never once it is cleared", async () => {
      const { host, user } = await renderApp("Power & lock", {
        config: { idle: { blank_after_seconds: 300 } },
      });
      const after = screen.getByRole("textbox", {
        name: "Lock after (seconds)",
      });
      await user.type(after, "900");
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).idle).toEqual({
          blank_after_seconds: 300,
          lock_after_seconds: 900,
        });
      });
      await user.clear(after);
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).idle).toEqual({ blank_after_seconds: 300 });
      });
    });

    it("unlocks through another PAM service", async () => {
      const { host, user } = await renderApp("Power & lock");
      await user.type(
        screen.getByRole("textbox", { name: "PAM service" }),
        "login",
      );
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes).lock).toEqual({ pam_service: "login" });
      });
    });

    it("unlocks through domicile once the service is cleared", async () => {
      const { host, user } = await renderApp("Power & lock", {
        config: { lock: { pam_service: "login" } },
      });
      await user.clear(screen.getByRole("textbox", { name: "PAM service" }));
      await user.tab();
      await waitFor(() => {
        expect(written(host.writes)).toEqual({});
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
      const { host, user } = await renderApp("Extensions");
      await user.click(
        await screen.findByRole("switch", { name: "uBlock Origin Lite" }),
      );
      await waitFor(() => {
        expect(host.state.installed[0]?.enabled).toBe(false);
      });
    });

    it("opens an extension's options", async () => {
      const { host, user } = await renderApp("Extensions");
      await user.click(
        await screen.findByRole("button", {
          name: "Options for uBlock Origin Lite",
        }),
      );
      expect(host.opened).toEqual([
        `chrome-extension://${UBLOCK}/dashboard.html`,
      ]);
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
    it("loads the unpacked folder chosen in the desktop's picker", async () => {
      const { host, user } = await renderApp("Extensions", {
        writable: false,
      });
      await user.click(
        screen.getByRole("button", { name: "Load unpacked folder" }),
      );
      await waitFor(() => {
        expect(host.loaded).toEqual(["/home/me/src/my-extension"]);
      });
    });

    it("loads nothing when the picker is canceled", async () => {
      const { host, user } = await renderApp("Extensions", { chosen: null });
      await user.click(
        screen.getByRole("button", { name: "Load unpacked folder" }),
      );
      await waitFor(() => {
        expect(host.chosen).toEqual([undefined]);
      });
      expect(host.loaded).toEqual([]);
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

    it("names an extension by its name", async () => {
      const { user } = await renderApp("Site permissions");
      await user.click(
        await screen.findByRole("button", { name: /^Notifications/ }),
      );
      expect(
        await screen.findByRole("combobox", { name: "uBlock Origin Lite" }),
      ).toHaveTextContent("Block");
    });

    it("picks the camera a site gets when it names none", async () => {
      const { host, user } = await renderApp("Site permissions");
      await user.click(await screen.findByRole("button", { name: /^Camera/ }));
      expect(
        await screen.findByRole("combobox", { name: "Camera device" }),
      ).toHaveTextContent("Integrated Camera");
      await choose(user, "Camera device", "USB Camera");
      await waitFor(() => {
        expect(host.state.media.cameras[0]?.id).toBe("/dev/video2");
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
        expect(host.state.sites.sites).toEqual([
          SITES.sites[2],
          SITES.sites[3],
        ]);
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
