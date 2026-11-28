// `domicile-app-host`, the process the app runs, as Settings uses it: the
// desktop's config and shell files, its site permissions and site data, the
// extensions it loads, configures and uninstalls, and its cameras and microphones. Every reply is
// parsed. The protocol is `domicile_launch::app_host`'s.

import { spawnedAppHost } from "@domicile-desktop/app-host-client";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import { z } from "zod";

import type { ConfigPath } from "./config-document";

/** Logs Save logs wrote. */
export type ExportedLogs = {
  /** The file. */
  path: string;
  /** What could not be hidden, and why, if anything. */
  unhidden: string | undefined;
};

export const PERMISSIONS = [
  "camera",
  "microphone",
  "location",
  "notifications",
  "clipboard",
  "midi",
  "window-management",
  "local-fonts",
  "idle-detection",
  "automatic-downloads",
] as const;

/** A permission a site can be granted. */
export type Permission = (typeof PERMISSIONS)[number];

export const SETTINGS = ["ask", "allow", "block"] as const;

/** What a site gets when it asks. */
export type Setting = (typeof SETTINGS)[number];

const fileSchema = z.object({
  path: z.string(),
  text: z.string(),
  writable: z.boolean(),
});

/** A file the app edits. */
export type HostFile = z.infer<typeof fileSchema>;

const configOverrideSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  value: z.string().transform((text): unknown => JSON.parse(text)),
  written: z.string().transform((text): unknown => JSON.parse(text)),
});

/**
 * A temporary change to the config: `value` in place of what the config has
 * at `path`, `written`, until the desktop stops. `null` is the setting's
 * default, or where the config has nothing.
 */
export type ConfigOverride = z.output<typeof configOverrideSchema>;

/** Which file a write replaces. */
export type Target = "config" | "shell";

const sitePermissionSchema = z.object({
  origin: z.string(),
  permission: z.enum(PERMISSIONS),
  setting: z.enum(SETTINGS),
});

/** One site's setting for one permission. */
export type SitePermission = z.infer<typeof sitePermissionSchema>;

const siteSettingsSchema = z.object({
  defaults: z.record(z.enum(PERMISSIONS), z.enum(SETTINGS)),
  sites: z.array(sitePermissionSchema),
});

/** Every permission's default and every site's own setting. */
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

const AD_BLOCKING_MODES = ["standard", "strict", "off"] as const;

/**
 * The protections a site turns on or off of its own, beside its ad blocking,
 * each by the config key it overrides.
 */
export const SITE_PROTECTIONS = [
  "hide_device_details",
  "remove_tracking_from_links",
  "hide_cookie_banners",
] as const;

/** One of {@link SITE_PROTECTIONS}. */
export type SiteProtection = (typeof SITE_PROTECTIONS)[number];

const sitePrivacySchema = z.object({
  block_ads_and_trackers: z.enum(AD_BLOCKING_MODES).nullable(),
  profile: z.string(),
  protections: z
    .partialRecord(z.enum(SITE_PROTECTIONS), z.boolean())
    .prefault({}),
  site: z.string(),
});

/**
 * A site with its own ad blocking or protections in a browser profile, as the
 * shield in a browser window keeps them: `block_ads_and_trackers` is `null`
 * for a site with only protections of its own. See
 * `docs/architecture/AD-BLOCKING.md`.
 */
export type SitePrivacy = z.infer<typeof sitePrivacySchema>;

/**
 * A change to one site. What it leaves out stays as it is; `null` goes back
 * to the profile's.
 */
export type SitePrivacyChange = {
  block_ads_and_trackers?: SitePrivacy["block_ads_and_trackers"];
  profile: string;
  protections?: Partial<Record<SiteProtection, boolean | null>>;
  site: string;
};

const siteDataSchema = z.object({
  bytes: z.number(),
  cookies: z.number(),
  host: z.string(),
});

/** What one host stores: its cookies, and its bytes on disk of every kind. */
export type SiteData = z.infer<typeof siteDataSchema>;

const agentReachSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("desk") }),
  z.object({
    type: z.literal("windows"),
    windows: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
]);

/** What an agent reaches: the whole desk, or these windows. */
export type AgentReach = z.infer<typeof agentReachSchema>;

const knownAgentsSchema = z
  .object({
    connected: z.array(
      z.object({
        agent: z.string(),
        reach: agentReachSchema,
        session: z.number(),
      }),
    ),
    remembered: z.array(
      z.object({ agent: z.string(), last_used_ms: z.number() }),
    ),
  })
  .transform(({ connected, remembered }) => ({
    connected,
    remembered: remembered.map(({ agent, last_used_ms }) => ({
      agent,
      lastUsedMs: last_used_ms,
    })),
  }));

/**
 * The agents in now, each by its session, and those let reach the whole
 * desk without asking, most recently used first.
 */
export type KnownAgents = z.output<typeof knownAgentsSchema>;

const webAgentsSchema = z
  .object({
    signed_in: z.array(
      z.object({
        client: z.string(),
        last_used_ms: z.number(),
        name: z.string(),
      }),
    ),
    status: z
      .object({
        address: z.string().nullable(),
        problem: z.string().nullable(),
        ready: z.boolean(),
      })
      .nullable(),
  })
  .transform(({ signed_in, status }) => ({
    signedIn: signed_in.map(({ client, last_used_ms, name }) => ({
      client,
      lastUsedMs: last_used_ms,
      name,
    })),
    status:
      status === null
        ? undefined
        : {
            address: status.address ?? undefined,
            problem: status.problem ?? undefined,
            ready: status.ready,
          },
  }));

/**
 * Agents on the web: how the desk's relay address is doing, `undefined`
 * until `domicile mcp --relay` first runs, and the agents signed in, most
 * recently used first.
 */
export type WebAgents = z.output<typeof webAgentsSchema>;

const mediaDeviceSchema = z.object({ id: z.string(), name: z.string() });

/** A camera or microphone. */
export type MediaDevice = z.infer<typeof mediaDeviceSchema>;

const mediaDevicesSchema = z.object({
  cameras: z.array(mediaDeviceSchema),
  microphones: z.array(mediaDeviceSchema),
});

/**
 * Each kind's devices, most preferred first. A site that names no device gets
 * the first.
 */
export type MediaDevices = z.infer<typeof mediaDevicesSchema>;

const monitorSchema = z.object({
  hdr: z.enum(["unsupported", "off", "on"]),
  names: z.array(z.string()),
});

/**
 * A lit monitor: every name a profile's `display` can match it by, and whether
 * it is in HDR. `unsupported` when its panel or connector can't show HDR.
 */
export type Monitor = z.infer<typeof monitorSchema>;

const extensionSettingsSchema = z.object({
  file_access: z.boolean().optional(),
  site_access: z
    .union([z.enum(["on_click", "all_sites"]), z.array(z.string())])
    .optional(),
  user_scripts: z.boolean().optional(),
});

/**
 * An extension's chrome://extensions settings, spelled as the config's
 * `extensions.settings`: whether it runs on local files, may run user
 * scripts, and which sites it runs on. A listed extension
 * has each it can use; a change names only those that change.
 */
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

const extensionSchema = z
  .object({
    description: z.string(),
    enabled: z.boolean(),
    icon: z.string().nullish(),
    id: z.string(),
    name: z.string(),
    options_url: z.string().nullish(),
    settings: extensionSettingsSchema,
    version: z.string(),
  })
  .transform(({ icon, options_url, ...extension }) => ({
    ...extension,
    icon: icon ?? undefined,
    optionsUrl: options_url ?? undefined,
  }));

/** An extension in the browser windows' profile. */
export type InstalledExtension = z.output<typeof extensionSchema>;

const profileExtensionSchema = z.object({
  enabled: z.boolean(),
  id: z.string(),
  locked: z.boolean(),
});

/**
 * One extension's switch in a browser profile. `locked` when the config
 * switches it, so only the config changes it.
 */
export type ProfileExtension = z.infer<typeof profileExtensionSchema>;

const browserProfileSchema = z.object({
  color: z.string(),
  extensions: z.array(profileExtensionSchema),
  id: z.string(),
  name: z.string(),
  private: z.boolean(),
});

/** A browser profile, as the desktop runs it. */
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

const browserSiteSchema = z.object({
  pinned: z.boolean(),
  profile: z.string(),
  site: z.string(),
});

/**
 * A site that opens in a profile other than the default. `pinned` when the
 * user chose it, from a browser window or Settings; otherwise the config
 * lists it.
 */
export type BrowserSite = z.infer<typeof browserSiteSchema>;

/** Every browser profile, and where each listed site opens. */
export type BrowserProfiles = {
  /** Where a link opens when no site names a profile. */
  defaultProfile: string;
  /** Where a private window opens when nothing names a profile. */
  defaultPrivateProfile: string;
  profiles: BrowserProfile[];
  sites: BrowserSite[];
};

/** Which list a device is in. */
export type MediaKind = "camera" | "microphone";

/**
 * The files the desktop runs: its config (none when it runs the defaults),
 * the JSON a module config evaluated to, the shell's source (none for a
 * package) and the options it declares (none when it declares none).
 */
export type SettingsFiles = {
  config: HostFile | undefined;
  evaluated: string | undefined;
  /** The shell's `options.json`, as text. */
  options: string | undefined;
  shell: HostFile | undefined;
};

/** What the app asks of the desktop. */
export type SettingsHost = {
  read: () => Promise<SettingsFiles>;
  /** Replaces a file. The host refuses a read-only file and a bad config. */
  write: (file: Target, text: string) => Promise<void>;
  sitePermissions: () => Promise<SiteSettings>;
  /** Stores a site's setting; a permission's default removes it. */
  setSitePermission: (site: SitePermission) => Promise<void>;
  /** Every browser profile's sites with their own ad blocking. */
  sitePrivacy: () => Promise<SitePrivacy[]>;
  /** Sets a site's ad blocking in a profile, or clears it with `null`. */
  setSitePrivacy: (change: SitePrivacyChange) => Promise<void>;
  /** Every host that stores data in browser windows' profile. */
  siteData: () => Promise<SiteData[]>;
  /** Removes everything `host` stores. */
  clearSiteData: (host: string) => Promise<void>;
  /**
   * Loads the unpacked extension in `directory`, absolute or under `~`, and
   * resolves with its id. It stays until uninstalled.
   */
  loadUnpacked: (directory: string) => Promise<string>;
  /**
   * Shows the desktop's folder picker. Resolves with the folder's absolute
   * path, or `undefined` if the user canceled.
   */
  chooseFolder: () => Promise<string | undefined>;
  /** Uninstalls an extension the config did not install. */
  uninstallExtension: (id: string) => Promise<void>;
  /** The ids of the extensions the config installed, which only it removes. */
  configExtensions: () => Promise<string[]>;
  /** Every extension in the browser windows' profile. */
  extensions: () => Promise<InstalledExtension[]>;
  /**
   * Switches an extension on or off: in every profile, or in `profile` alone.
   * The engine refuses a switch the config sets.
   */
  setExtensionEnabled: (
    id: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<void>;
  /** The browser profiles the desktop runs, and where each listed site opens. */
  browserProfiles: () => Promise<BrowserProfiles>;
  /**
   * Opens `site` in `profile` from now on; the default profile unpins it. The
   * engine refuses a site the config lists.
   */
  pinBrowserSite: (site: string, profile: string) => Promise<void>;
  /** Changes each of `settings` that is set; the engine refuses one `id` cannot use. */
  configureExtension: (
    id: string,
    settings: ExtensionSettings,
  ) => Promise<void>;
  /** Opens `url` in a browser window. */
  openUrl: (url: string) => Promise<void>;
  mediaDevices: () => Promise<MediaDevices>;
  /** The lit monitors. */
  monitors: () => Promise<Monitor[]>;
  /** The temporary changes to the config, in the order they were made. */
  configOverrides: () => Promise<ConfigOverride[]>;
  /**
   * Lays `value` over the config at `path` until the desktop stops;
   * `undefined` takes the setting back to its default. Resolves with the
   * temporary changes after it. The desktop refuses a value the config would.
   */
  setConfigOverride: (
    path: ConfigPath,
    value: unknown,
  ) => Promise<ConfigOverride[]>;
  /** Ends the temporary changes at or under each of `paths`. */
  resetConfigOverrides: (
    paths: readonly ConfigPath[],
  ) => Promise<ConfigOverride[]>;
  /** Gives device `id` to sites that ask for a `kind` without naming one. */
  setMediaDevice: (kind: MediaKind, id: string) => Promise<void>;
  /** The agents in now, and those remembered. */
  agents: () => Promise<KnownAgents>;
  /** Ends agent session `session`, as the bar's Stop does. */
  stopAgent: (session: number) => Promise<void>;
  /** Makes remembered agent `agent` ask again next time. */
  forgetAgent: (agent: string) => Promise<void>;
  /** Agents on the web: the relay address, and who is signed in. */
  webAgents: () => Promise<WebAgents>;
  /** Signs agent `client` on the web out, so the user must allow it again. */
  signOutWebAgent: (client: string) => Promise<void>;
  /** Has the desk try for its certificate again now, not when it would. */
  retryWebAgents: () => Promise<void>;
  /** Whether the desktop logs everything at debug, until it restarts. */
  detailedLogging: () => Promise<boolean>;
  /** Turns detailed logging on, or back to the starting levels. */
  setDetailedLogging: (on: boolean) => Promise<boolean>;
  /**
   * Saves the desktop's logs to Downloads, hiding web addresses and window
   * titles if `redact`.
   */
  exportLogs: (redact: boolean) => Promise<ExportedLogs>;
  /** Opens the Downloads folder Save logs writes to. */
  openDownloads: () => Promise<void>;
  /** Calls `listener` when a file changes on disk. Returns an unsubscribe. */
  onChange: (listener: () => void) => () => void;
};

/**
 * The host as a process the app spawns, speaking framed JSON on its stdin and
 * stdout. It starts on the first request, and again after it ends.
 */
export const spawnedHost = (
  processes: Pick<Processes, "spawn">,
): SettingsHost => {
  const changes = new Set<() => void>();
  const { ask, start } = spawnedAppHost({
    onEvent: (message) => {
      eventSchema.parse(message);
      for (const listener of changes) {
        listener();
      }
    },
    processes,
    replies: replySchema,
  });

  return {
    agents: async () => {
      const reply = await ask({ type: "agents" }, "agents");
      return reply.agents;
    },
    browserProfiles: async () => {
      const reply = await ask({ type: "browser_profiles" }, "browser_profiles");
      return {
        defaultPrivateProfile: reply.default_private_profile,
        defaultProfile: reply.default_profile,
        profiles: reply.profiles,
        sites: reply.sites,
      };
    },
    chooseFolder: async () => {
      const reply = await ask({ type: "choose_folder" }, "folder");
      return reply.path ?? undefined;
    },
    clearSiteData: async (host) => {
      await ask({ host, type: "clear_site_data" }, "cleared");
    },
    configExtensions: async () => {
      const reply = await ask(
        { type: "config_extensions" },
        "config_extensions",
      );
      return reply.ids;
    },
    configOverrides: async () =>
      (await ask({ type: "config_overrides" }, "config_overrides")).overrides,
    configureExtension: async (extension, settings) => {
      await ask(
        {
          extension,
          settings,
          type: "configure_extension",
        },
        "stored",
      );
    },
    detailedLogging: async () => {
      const reply = await ask({ type: "detailed_logging" }, "detailed_logging");
      return reply.on;
    },
    exportLogs: async (redact) => {
      const reply = await ask({ redact, type: "export_logs" }, "exported_logs");
      return { path: reply.path, unhidden: reply.unhidden ?? undefined };
    },
    extensions: async () => {
      const reply = await ask({ type: "extensions" }, "extensions");
      return reply.extensions;
    },
    forgetAgent: async (agent) => {
      await ask({ agent, type: "forget_agent" }, "done");
    },
    loadUnpacked: async (directory) => {
      const reply = await ask(
        { directory, type: "load_unpacked" },
        "loaded_unpacked",
      );
      return reply.extension;
    },
    mediaDevices: async () => {
      const reply = await ask({ type: "media_devices" }, "media_devices");
      return { cameras: reply.cameras, microphones: reply.microphones };
    },
    monitors: async () => {
      const reply = await ask({ type: "monitors" }, "monitors");
      return reply.monitors;
    },
    onChange: (listener) => {
      changes.add(listener);
      start();
      return () => {
        changes.delete(listener);
      };
    },
    openDownloads: async () => {
      await ask({ type: "open_downloads" }, "opened");
    },
    openUrl: async (url) => {
      await ask({ type: "open_url", url }, "opened");
    },
    pinBrowserSite: async (site, profile) => {
      await ask({ profile, site, type: "pin_browser_site" }, "stored");
    },
    read: async () => {
      const reply = await ask({ type: "read" }, "files");
      return {
        config: reply.config ?? undefined,
        evaluated: reply.evaluated ?? undefined,
        options: reply.options ?? undefined,
        shell: reply.shell ?? undefined,
      };
    },
    resetConfigOverrides: async (paths) =>
      (await ask({ paths, type: "reset_config_overrides" }, "config_overrides"))
        .overrides,
    retryWebAgents: async () => {
      await ask({ type: "retry_web_agents" }, "done");
    },
    setConfigOverride: async (path, value) =>
      (
        await ask(
          {
            path,
            type: "set_config_override",
            value: JSON.stringify(value ?? null),
          },
          "config_overrides",
        )
      ).overrides,
    setDetailedLogging: async (on) => {
      const reply = await ask(
        { on, type: "set_detailed_logging" },
        "detailed_logging",
      );
      return reply.on;
    },
    setExtensionEnabled: async (extension, enabled, profile) => {
      await ask(
        {
          enabled,
          extension,
          ...(profile === undefined ? {} : { profile }),
          type: "set_extension_enabled",
        },
        "stored",
      );
    },
    setMediaDevice: async (kind, device) => {
      await ask({ device, kind, type: "set_media_device" }, "stored");
    },
    setSitePermission: async (site) => {
      await ask({ site, type: "set_site_permission" }, "stored");
    },
    setSitePrivacy: async (change) => {
      await ask({ change, type: "set_site_privacy" }, "stored");
    },
    signOutWebAgent: async (client) => {
      await ask({ client, type: "sign_out_web_agent" }, "done");
    },
    siteData: async () => {
      const reply = await ask({ type: "site_data" }, "site_data");
      return reply.sites;
    },
    sitePermissions: async () => {
      const reply = await ask({ type: "site_permissions" }, "site_permissions");
      return { defaults: reply.defaults, sites: reply.sites };
    },
    sitePrivacy: async () => {
      const reply = await ask({ type: "site_privacy" }, "site_privacy");
      return reply.sites;
    },
    stopAgent: async (session) => {
      await ask({ session, type: "stop_agent" }, "done");
    },
    uninstallExtension: async (extension) => {
      await ask({ extension, type: "uninstall_extension" }, "uninstalled");
    },
    webAgents: async () => {
      const reply = await ask({ type: "web_agents" }, "web_agents");
      return reply.webAgents;
    },
    write: async (file, text) => {
      await ask({ file, text, type: "write" }, "written");
    },
  };
};

const replySchema = z.discriminatedUnion("type", [
  z.object({
    config: fileSchema.nullable(),
    evaluated: z.string().nullable(),
    id: z.number(),
    options: z.string().nullable(),
    shell: fileSchema.nullable(),
    type: z.literal("files"),
  }),
  z.object({ id: z.number(), type: z.literal("written") }),
  siteSettingsSchema.extend({
    id: z.number(),
    type: z.literal("site_permissions"),
  }),
  z.object({
    id: z.number(),
    sites: z.array(sitePrivacySchema),
    type: z.literal("site_privacy"),
  }),
  z.object({ id: z.number(), type: z.literal("stored") }),
  z.object({
    extension: z.string(),
    id: z.number(),
    type: z.literal("loaded_unpacked"),
  }),
  z.object({ id: z.number(), type: z.literal("uninstalled") }),
  z.object({
    id: z.number(),
    path: z.string().nullable(),
    type: z.literal("folder"),
  }),
  z.object({
    id: z.number(),
    ids: z.array(z.string()),
    type: z.literal("config_extensions"),
  }),
  mediaDevicesSchema.extend({
    id: z.number(),
    type: z.literal("media_devices"),
  }),
  z.object({
    id: z.number(),
    monitors: z.array(monitorSchema),
    type: z.literal("monitors"),
  }),
  z.object({
    id: z.number(),
    overrides: z.array(configOverrideSchema),
    type: z.literal("config_overrides"),
  }),
  z.object({
    extensions: z.array(extensionSchema),
    id: z.number(),
    type: z.literal("extensions"),
  }),
  z.object({ id: z.number(), type: z.literal("opened") }),
  z.object({
    default_private_profile: z.string(),
    default_profile: z.string(),
    id: z.number(),
    profiles: z.array(browserProfileSchema),
    sites: z.array(browserSiteSchema),
    type: z.literal("browser_profiles"),
  }),
  z.object({
    id: z.number(),
    sites: z.array(siteDataSchema),
    type: z.literal("site_data"),
  }),
  z.object({ id: z.number(), type: z.literal("cleared") }),
  z.object({
    agents: knownAgentsSchema,
    id: z.number(),
    type: z.literal("agents"),
  }),
  z
    .object({
      id: z.number(),
      signed_in: z.unknown(),
      status: z.unknown(),
      type: z.literal("web_agents"),
    })
    .transform(({ id, signed_in, status, type }) => ({
      id,
      type,
      webAgents: webAgentsSchema.parse({ signed_in, status }),
    })),
  z.object({ id: z.number(), type: z.literal("done") }),
  z.object({
    id: z.number(),
    on: z.boolean(),
    type: z.literal("detailed_logging"),
  }),
  z.object({
    id: z.number(),
    path: z.string(),
    type: z.literal("exported_logs"),
    unhidden: z.string().nullable(),
  }),
]);

/** The one event the host sends: a file changed on disk. */
const eventSchema = z.object({ type: z.literal("changed") });
