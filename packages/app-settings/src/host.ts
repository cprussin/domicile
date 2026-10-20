// `domicile-app-host`, the process the app runs, as Settings uses it: the
// desktop's config and shell files, its site permissions and site data, the
// extensions it loads and uninstalls, and its cameras and microphones. Every reply is
// parsed. The protocol is `domicile_launch::app_host`'s.

import type { Result } from "@cprussin/option-result";
import {
  encodeFrame,
  frameDecoder,
} from "@domicile-desktop/component-library/app-host-frames";
import type {
  Exit,
  Subprocess,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { z } from "zod";

/** The command that starts the host. */
const HOST = ["domicile-app-host"];

export const PERMISSIONS = [
  "camera",
  "microphone",
  "location",
  "notifications",
  "clipboard",
  "midi",
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

const siteDataSchema = z.object({
  bytes: z.number(),
  cookies: z.number(),
  host: z.string(),
});

/** What one host stores: its cookies, and its bytes on disk of every kind. */
export type SiteData = z.infer<typeof siteDataSchema>;

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

const extensionSchema = z
  .object({
    description: z.string(),
    enabled: z.boolean(),
    id: z.string(),
    name: z.string(),
    options_url: z.string().nullish(),
    version: z.string(),
  })
  .transform(({ options_url, ...extension }) => ({
    ...extension,
    optionsUrl: options_url ?? undefined,
  }));

/** An extension in the browser windows' profile. */
export type InstalledExtension = z.output<typeof extensionSchema>;

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
  setExtensionEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Opens `url` in a browser window. */
  openUrl: (url: string) => Promise<void>;
  mediaDevices: () => Promise<MediaDevices>;
  /** Gives device `id` to sites that ask for a `kind` without naming one. */
  setMediaDevice: (kind: MediaKind, id: string) => Promise<void>;
  /** Calls `listener` when a file changes on disk. Returns an unsubscribe. */
  onChange: (listener: () => void) => () => void;
};

/**
 * The host as a process the app spawns, speaking framed JSON on its stdin and
 * stdout. It starts on the first request, and again after it ends.
 */
export const spawnedHost = (system: Pick<System, "spawn">): SettingsHost => {
  const pending = new Map<number, Pending>();
  const changes = new Set<() => void>();
  let running: Promise<Subprocess> | undefined;
  let lastId = 0;

  const ended = (why: Error) => {
    running = undefined;
    for (const waiting of pending.values()) {
      waiting.reject(why);
    }
    pending.clear();
  };

  const connected = (): Promise<Subprocess> => {
    if (running === undefined) {
      const starting = system.spawn(HOST, { stdin: true }).then((spawned) =>
        spawned.match({
          Err: (error) => {
            running = undefined;
            throw new Error(error.message);
          },
          Ok: (process) => {
            follow(process, (message) => {
              received(message, pending, changes);
            }).then(ended, (error: unknown) => {
              ended(new Error("The settings host stopped", { cause: error }));
            });
            return process;
          },
        }),
      );
      running = starting;
      return starting;
    } else {
      return running;
    }
  };

  const ask = (request: Record<string, unknown>) =>
    new Promise<Reply>((resolve, reject) => {
      lastId += 1;
      const id = lastId;
      pending.set(id, { reject, resolve });
      connected().then(
        (process) => {
          process.write(encodeFrame({ ...request, id }));
        },
        (error: unknown) => {
          pending.delete(id);
          reject(error);
        },
      );
    });

  return {
    chooseFolder: async () => {
      const reply = await ask({ type: "choose_folder" });
      if (reply.type === "folder") {
        return reply.path ?? undefined;
      } else {
        throw unexpected(reply, "folder");
      }
    },
    clearSiteData: async (host) => {
      const reply = await ask({ host, type: "clear_site_data" });
      if (reply.type !== "cleared") {
        throw unexpected(reply, "cleared");
      }
    },
    configExtensions: async () => {
      const reply = await ask({ type: "config_extensions" });
      if (reply.type === "config_extensions") {
        return reply.ids;
      } else {
        throw unexpected(reply, "config_extensions");
      }
    },
    extensions: async () => {
      const reply = await ask({ type: "extensions" });
      if (reply.type === "extensions") {
        return reply.extensions;
      } else {
        throw unexpected(reply, "extensions");
      }
    },
    loadUnpacked: async (directory) => {
      const reply = await ask({ directory, type: "load_unpacked" });
      if (reply.type === "loaded_unpacked") {
        return reply.extension;
      } else {
        throw unexpected(reply, "loaded_unpacked");
      }
    },
    mediaDevices: async () => {
      const reply = await ask({ type: "media_devices" });
      if (reply.type === "media_devices") {
        return { cameras: reply.cameras, microphones: reply.microphones };
      } else {
        throw unexpected(reply, "media_devices");
      }
    },
    onChange: (listener) => {
      changes.add(listener);
      // A failed start fails the requests made with it, which report it.
      connected().catch(() => {
        /* reported by the requests */
      });
      return () => {
        changes.delete(listener);
      };
    },
    openUrl: async (url) => {
      const reply = await ask({ type: "open_url", url });
      if (reply.type !== "opened") {
        throw unexpected(reply, "opened");
      }
    },
    read: async () => {
      const reply = await ask({ type: "read" });
      if (reply.type === "files") {
        return {
          config: reply.config ?? undefined,
          evaluated: reply.evaluated ?? undefined,
          options: reply.options ?? undefined,
          shell: reply.shell ?? undefined,
        };
      } else {
        throw unexpected(reply, "files");
      }
    },
    setExtensionEnabled: async (extension, enabled) => {
      const reply = await ask({
        enabled,
        extension,
        type: "set_extension_enabled",
      });
      if (reply.type !== "stored") {
        throw unexpected(reply, "stored");
      }
    },
    setMediaDevice: async (kind, device) => {
      const reply = await ask({ device, kind, type: "set_media_device" });
      if (reply.type !== "stored") {
        throw unexpected(reply, "stored");
      }
    },
    setSitePermission: async (site) => {
      const reply = await ask({ site, type: "set_site_permission" });
      if (reply.type !== "stored") {
        throw unexpected(reply, "stored");
      }
    },
    siteData: async () => {
      const reply = await ask({ type: "site_data" });
      if (reply.type === "site_data") {
        return reply.sites;
      } else {
        throw unexpected(reply, "site_data");
      }
    },
    sitePermissions: async () => {
      const reply = await ask({ type: "site_permissions" });
      if (reply.type === "site_permissions") {
        return { defaults: reply.defaults, sites: reply.sites };
      } else {
        throw unexpected(reply, "site_permissions");
      }
    },
    uninstallExtension: async (extension) => {
      const reply = await ask({ extension, type: "uninstall_extension" });
      if (reply.type !== "uninstalled") {
        throw unexpected(reply, "uninstalled");
      }
    },
    write: async (file, text) => {
      const reply = await ask({ file, text, type: "write" });
      if (reply.type !== "written") {
        throw unexpected(reply, "written");
      }
    },
  };
};

/** A request waiting for its reply. */
type Pending = {
  reject: (error: Error) => void;
  resolve: (reply: Reply) => void;
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
    extensions: z.array(extensionSchema),
    id: z.number(),
    type: z.literal("extensions"),
  }),
  z.object({ id: z.number(), type: z.literal("opened") }),
  z.object({
    id: z.number(),
    sites: z.array(siteDataSchema),
    type: z.literal("site_data"),
  }),
  z.object({ id: z.number(), type: z.literal("cleared") }),
  z.object({ id: z.number(), type: z.literal("refused"), why: z.string() }),
  z.object({ type: z.literal("changed") }),
]);

type Reply = z.output<typeof replySchema>;

/** Settles the request `message` answers, or tells listeners of a change. */
const received = (
  message: unknown,
  pending: Map<number, Pending>,
  changes: ReadonlySet<() => void>,
) => {
  const reply = replySchema.parse(message);
  if (reply.type === "changed") {
    for (const listener of changes) {
      listener();
    }
  } else {
    const waiting = pending.get(reply.id);
    if (waiting === undefined) {
      throw new Error(`The settings host answered ${reply.id}, never asked`);
    } else {
      pending.delete(reply.id);
      if (reply.type === "refused") {
        waiting.reject(new Error(reply.why));
      } else {
        waiting.resolve(reply);
      }
    }
  }
};

/** The error for a reply of the wrong type. */
const unexpected = (reply: Reply, wanted: Reply["type"]) =>
  new Error(`The settings host answered ${reply.type}, not ${wanted}`);

/**
 * Hands each message `process` writes to `received` until it ends, and
 * resolves with why it ended. A message `received` throws on stops it.
 */
const follow = async (
  process: Subprocess,
  received: (message: unknown) => void,
): Promise<Error> => {
  const decode = frameDecoder();
  const [broken, stderr, exit] = await Promise.all([
    eachChunk(process.stdout, (chunk) => {
      for (const message of decode(chunk)) {
        received(message);
      }
    }).then(
      () => undefined,
      (error: unknown) => {
        process.kill();
        return new Error("The settings host sent a bad message", {
          cause: error,
        });
      },
    ),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return broken ?? new Error(whyEnded(stderr, exit));
};

/** Why the host ended: what it said on stderr, or how it exited. */
const whyEnded = (stderr: string, exit: Result<Exit, SystemError>): string =>
  stderr.trim() === ""
    ? exit.match({
        Err: (error) => error.message,
        Ok: ({ code, signal }) =>
          signal === undefined
            ? `The settings host exited with code ${String(code)}`
            : `The settings host was killed by signal ${String(signal)}`,
      })
    : stderr.trim();

/** Calls `each` with every chunk `stream` reads, until it closes. */
const eachChunk = async (
  stream: ReadableStream<Uint8Array>,
  each: (chunk: Uint8Array) => void,
) => {
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    each(read.value);
  }
};
