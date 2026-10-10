// The app's native messaging host, `domicile-settings-host`: the desktop's
// config and shell files, and its site permissions. Every reply is parsed.
// The protocol is `domicile_launch::settings`'s.

import { z } from "zod";

/** The host's name in its native messaging manifest. */
const HOST = "domicile.settings";

/** A `chrome.*` event. */
type ChromeEvent<Listener> = {
  addListener: (listener: Listener) => void;
};

/** The parts of a `chrome.runtime.Port` the app uses. */
export type NativePort = {
  onDisconnect: ChromeEvent<() => void>;
  onMessage: ChromeEvent<(message: unknown) => void>;
  postMessage: (message: unknown) => void;
};

/** The parts of `chrome.runtime` the app uses. */
export type NativeRuntime = {
  connectNative: (application: string) => NativePort;
  lastError: { message?: string | undefined } | undefined;
};

declare const chrome: { runtime: NativeRuntime };

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

/**
 * The files the desktop runs: its config (none when it runs the defaults),
 * the JSON a module config evaluated to, and the shell's source (none for a
 * package).
 */
export type SettingsFiles = {
  config: HostFile | undefined;
  evaluated: string | undefined;
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
  /** Calls `listener` when a file changes on disk. Returns an unsubscribe. */
  onChange: (listener: () => void) => () => void;
};

/**
 * The host over native messaging. It connects on the first request, and
 * again after it goes away, since Chrome stops a host whose port closes.
 */
export const nativeHost = (
  runtime: NativeRuntime = chrome.runtime,
): SettingsHost => {
  const pending = new Map<number, Pending>();
  const changes = new Set<() => void>();
  let port: NativePort | undefined;
  let lastId = 0;

  const connected = (): NativePort => {
    if (port === undefined) {
      const opened = runtime.connectNative(HOST);
      opened.onMessage.addListener((message) => {
        received(message, pending, changes);
      });
      opened.onDisconnect.addListener(() => {
        port = undefined;
        const why = new Error(
          runtime.lastError?.message ?? "The settings host stopped",
        );
        for (const waiting of pending.values()) {
          waiting.reject(why);
        }
        pending.clear();
      });
      port = opened;
      return opened;
    } else {
      return port;
    }
  };

  const ask = (request: Record<string, unknown>) =>
    new Promise<Reply>((resolve, reject) => {
      lastId += 1;
      pending.set(lastId, { reject, resolve });
      connected().postMessage({ ...request, id: lastId });
    });

  return {
    onChange: (listener) => {
      changes.add(listener);
      connected();
      return () => {
        changes.delete(listener);
      };
    },
    read: async () => {
      const reply = await ask({ type: "read" });
      if (reply.type === "files") {
        return {
          config: reply.config ?? undefined,
          evaluated: reply.evaluated ?? undefined,
          shell: reply.shell ?? undefined,
        };
      } else {
        throw unexpected(reply, "files");
      }
    },
    setSitePermission: async (site) => {
      const reply = await ask({ site, type: "set_site_permission" });
      if (reply.type !== "stored") {
        throw unexpected(reply, "stored");
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
    shell: fileSchema.nullable(),
    type: z.literal("files"),
  }),
  z.object({ id: z.number(), type: z.literal("written") }),
  siteSettingsSchema.extend({
    id: z.number(),
    type: z.literal("site_permissions"),
  }),
  z.object({ id: z.number(), type: z.literal("stored") }),
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
