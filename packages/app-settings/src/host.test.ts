import { describe, expect, it } from "bun:test";
import {
  settled,
  started as startedOver,
} from "@domicile-desktop/app-host-client/fake";

import type { SettingsHost, SitePermission } from "./host";
import { spawnedHost } from "./host";

/** The host over fake processes, with what it already asked. */
const started = <T>(ask: (host: SettingsHost) => T) =>
  startedOver(spawnedHost, ask);

const DEFAULTS = {
  "automatic-downloads": "ask",
  camera: "ask",
  clipboard: "ask",
  "idle-detection": "ask",
  "local-fonts": "ask",
  location: "ask",
  microphone: "ask",
  midi: "ask",
  notifications: "allow",
  "window-management": "ask",
} as const;

const FILES = {
  config: {
    path: "/home/me/.config/domicile/domicile.json",
    text: "{}",
    writable: true,
  },
  evaluated: null,
  options: '{"gaps":{"kind":"number","label":"Gaps","default":8}}',
  shell: null,
};

describe(spawnedHost, () => {
  describe("requests", () => {
    it("reads the files, matching the reply to its request", async () => {
      const { asked, processes } = await started((host) => host.read());
      expect(processes[0]?.sent).toEqual([{ id: 1, type: "read" }]);
      processes[0]?.answer({ id: 1, type: "files", ...FILES });
      expect(await asked).toEqual({
        config: FILES.config,
        evaluated: undefined,
        options: FILES.options,
        shell: undefined,
      });
    });

    it("rejects with the host's reason when it refuses", async () => {
      const { asked, processes } = await started((host) =>
        host.write("shell", "x"),
      );
      expect(processes[0]?.sent).toEqual([
        { file: "shell", id: 1, text: "x", type: "write" },
      ]);
      processes[0]?.answer({
        id: 1,
        type: "refused",
        why: "shell.ts is read-only",
      });
      await expect(asked).rejects.toThrow("shell.ts is read-only");
    });

    it("lists and sets site permissions", async () => {
      const { asked, host, processes } = await started((host) =>
        host.sitePermissions(),
      );
      const sites: SitePermission[] = [
        {
          origin: "https://meet.example",
          permission: "camera",
          setting: "allow",
        },
      ];
      processes[0]?.answer({
        defaults: DEFAULTS,
        id: 1,
        sites,
        type: "site_permissions",
      });
      expect(await asked).toEqual({ defaults: DEFAULTS, sites });

      const site = {
        origin: "https://meet.example",
        permission: "camera",
        setting: "block",
      } as const;
      const stored = host.setSitePermission(site);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        site,
        type: "set_site_permission",
      });
      processes[0]?.answer({ id: 2, type: "stored" });
      await stored;
    });

    it("lists and sets the sites' ad blocking", async () => {
      const { asked, host, processes } = await started((host) =>
        host.sitePrivacy(),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "site_privacy",
      });
      const sites = [
        {
          block_ads_and_trackers: "off",
          profile: "work",
          site: "nytimes.com",
        },
        {
          block_ads_and_trackers: null,
          profile: "work",
          protections: { hide_device_details: false },
          site: "zoom.us",
        },
      ] as const;
      processes[0]?.answer({ id: 1, sites, type: "site_privacy" });
      // An engine before protections names none: none of its own.
      expect(await asked).toEqual([{ ...sites[0], protections: {} }, sites[1]]);

      const change = {
        block_ads_and_trackers: null,
        profile: "work",
        site: "nytimes.com",
      };
      const stored = host.setSitePrivacy(change);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        change,
        id: 2,
        type: "set_site_privacy",
      });
      processes[0]?.answer({ id: 2, type: "stored" });
      await stored;
    });

    it("lists, sets and resets temporary changes to the config", async () => {
      const { asked, host, processes } = await started((host) =>
        host.configOverrides(),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "config_overrides",
      });
      const dark = [
        { path: ["theme", "mode"], value: '"dark"', written: '"light"' },
      ];
      processes[0]?.answer({
        id: 1,
        overrides: dark,
        type: "config_overrides",
      });
      expect(await asked).toEqual([
        { path: ["theme", "mode"], value: "dark", written: "light" },
      ]);

      const set = host.setConfigOverride(["browser", "order", 0], undefined);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        path: ["browser", "order", 0],
        type: "set_config_override",
        value: "null",
      });
      processes[0]?.answer({ id: 2, overrides: [], type: "config_overrides" });
      expect(await set).toEqual([]);

      const reset = host.resetConfigOverrides([["theme"]]);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 3,
        paths: [["theme"]],
        type: "reset_config_overrides",
      });
      processes[0]?.answer({ id: 3, overrides: [], type: "config_overrides" });
      expect(await reset).toEqual([]);
    });

    it("lists the monitors", async () => {
      const { asked, processes } = await started((host) => host.monitors());
      const monitors = [{ hdr: "unsupported" as const, names: ["drm-1"] }];
      expect(processes[0]?.sent.at(-1)).toEqual({ id: 1, type: "monitors" });
      processes[0]?.answer({ id: 1, monitors, type: "monitors" });
      expect(await asked).toEqual(monitors);
    });

    it("lists, stops and forgets agents", async () => {
      const { asked, host, processes } = await started((host) => host.agents());
      expect(processes[0]?.sent.at(-1)).toEqual({ id: 1, type: "agents" });
      processes[0]?.answer({
        agents: {
          connected: [
            { agent: "Claude Code", reach: { type: "desk" }, session: 4 },
          ],
          remembered: [{ agent: "Codex", last_used_ms: 9 }],
        },
        id: 1,
        type: "agents",
      });
      expect(await asked).toEqual({
        connected: [
          { agent: "Claude Code", reach: { type: "desk" }, session: 4 },
        ],
        remembered: [{ agent: "Codex", lastUsedMs: 9 }],
      });

      const stopped = host.stopAgent(4);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        session: 4,
        type: "stop_agent",
      });
      processes[0]?.answer({ id: 2, type: "done" });
      await stopped;

      const forgot = host.forgetAgent("Codex");
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        agent: "Codex",
        id: 3,
        type: "forget_agent",
      });
      processes[0]?.answer({ id: 3, type: "done" });
      await forgot;
    });

    it("lists media devices and prefers one", async () => {
      const { asked, host, processes } = await started((host) =>
        host.mediaDevices(),
      );
      const devices = {
        cameras: [{ id: "/dev/video2", name: "USB Camera" }],
        microphones: [],
      };
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "media_devices",
      });
      processes[0]?.answer({ ...devices, id: 1, type: "media_devices" });
      expect(await asked).toEqual(devices);

      const stored = host.setMediaDevice("camera", "/dev/video2");
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        device: "/dev/video2",
        id: 2,
        kind: "camera",
        type: "set_media_device",
      });
      processes[0]?.answer({ id: 2, type: "stored" });
      await stored;
    });

    it("lists site data and clears a host's", async () => {
      const { asked, host, processes } = await started((host) =>
        host.siteData(),
      );
      const sites = [{ bytes: 2048, cookies: 1, host: "a.example" }];
      expect(processes[0]?.sent.at(-1)).toEqual({ id: 1, type: "site_data" });
      processes[0]?.answer({ id: 1, sites, type: "site_data" });
      expect(await asked).toEqual(sites);

      const cleared = host.clearSiteData("a.example");
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        host: "a.example",
        id: 2,
        type: "clear_site_data",
      });
      processes[0]?.answer({ id: 2, type: "cleared" });
      await cleared;
    });

    it("loads and uninstalls extensions, and lists the config's", async () => {
      const id = "b".repeat(32);
      const { asked, host, processes } = await started((host) =>
        host.loadUnpacked("~/src/my-extension"),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        directory: "~/src/my-extension",
        id: 1,
        type: "load_unpacked",
      });
      processes[0]?.answer({ extension: id, id: 1, type: "loaded_unpacked" });
      expect(await asked).toBe(id);

      const uninstalled = host.uninstallExtension(id);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        extension: id,
        id: 2,
        type: "uninstall_extension",
      });
      processes[0]?.answer({ id: 2, type: "uninstalled" });
      await uninstalled;

      const listed = host.configExtensions();
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 3,
        type: "config_extensions",
      });
      processes[0]?.answer({ id: 3, ids: [id], type: "config_extensions" });
      expect(await listed).toEqual([id]);
    });

    it("lists the installed extensions, with or without options pages", async () => {
      const { asked, processes } = await started((host) => host.extensions());
      expect(processes[0]?.sent).toEqual([{ id: 1, type: "extensions" }]);
      const extension = {
        description: "An efficient content blocker.",
        enabled: true,
        id: "a".repeat(32),
        name: "uBlock Origin Lite",
        settings: { file_access: false, site_access: ["github.com"] },
        version: "2025.1",
      };
      processes[0]?.answer({
        extensions: [
          {
            ...extension,
            icon: "data:image/png;base64,iVBORw==",
            options_url: "chrome-extension://a/options.html",
          },
          { ...extension, icon: null, options_url: null },
          extension,
        ],
        id: 1,
        type: "extensions",
      });
      expect(await asked).toEqual([
        {
          ...extension,
          icon: "data:image/png;base64,iVBORw==",
          optionsUrl: "chrome-extension://a/options.html",
        },
        { ...extension, icon: undefined, optionsUrl: undefined },
        { ...extension, icon: undefined, optionsUrl: undefined },
      ]);
    });

    it("switches an extension and opens a URL", async () => {
      const { asked, host, processes } = await started((host) =>
        host.setExtensionEnabled("a".repeat(32), false),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        enabled: false,
        extension: "a".repeat(32),
        id: 1,
        type: "set_extension_enabled",
      });
      processes[0]?.answer({ id: 1, type: "stored" });
      await asked;

      const opened = host.openUrl("chrome-extension://a/options.html");
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        type: "open_url",
        url: "chrome-extension://a/options.html",
      });
      processes[0]?.answer({ id: 2, type: "opened" });
      await opened;
    });

    it("changes an extension's settings", async () => {
      const { asked, processes } = await started((host) =>
        host.configureExtension("a".repeat(32), { site_access: "on_click" }),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        extension: "a".repeat(32),
        id: 1,
        settings: { site_access: "on_click" },
        type: "configure_extension",
      });
      processes[0]?.answer({ id: 1, type: "stored" });
      await asked;
    });

    it("asks the desktop's picker for a folder", async () => {
      const { asked, host, processes } = await started((host) =>
        host.chooseFolder(),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "choose_folder",
      });
      processes[0]?.answer({ id: 1, path: "/home/me/src/x", type: "folder" });
      expect(await asked).toBe("/home/me/src/x");

      const canceled = host.chooseFolder();
      await settled();
      processes[0]?.answer({ id: 2, path: null, type: "folder" });
      expect(await canceled).toBeUndefined();
    });

    it("reads and switches detailed logging", async () => {
      const { asked, host, processes } = await started((host) =>
        host.detailedLogging(),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "detailed_logging",
      });
      processes[0]?.answer({ id: 1, on: false, type: "detailed_logging" });
      expect(await asked).toBe(false);

      const switched = host.setDetailedLogging(true);
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        on: true,
        type: "set_detailed_logging",
      });
      processes[0]?.answer({ id: 2, on: true, type: "detailed_logging" });
      expect(await switched).toBe(true);
    });

    it("saves the logs and opens Downloads", async () => {
      const { asked, host, processes } = await started((host) =>
        host.exportLogs(false),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        redact: false,
        type: "export_logs",
      });
      processes[0]?.answer({
        id: 1,
        path: "/home/me/Downloads/domicile-logs.txt",
        type: "exported_logs",
        unhidden: "web addresses and window titles are not hidden",
      });
      expect(await asked).toEqual({
        path: "/home/me/Downloads/domicile-logs.txt",
        unhidden: "web addresses and window titles are not hidden",
      });

      const opened = host.openDownloads();
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        type: "open_downloads",
      });
      processes[0]?.answer({ id: 2, type: "opened" });
      await opened;
    });

    it("tells listeners a file changed on disk", async () => {
      const { asked, processes } = await started(
        (host) =>
          new Promise<void>((resolve) => {
            host.onChange(resolve);
          }),
      );
      processes[0]?.answer({ type: "changed" });
      await asked;
    });
  });
});
