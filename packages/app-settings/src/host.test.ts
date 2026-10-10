import { describe, expect, it } from "bun:test";

import type { NativePort, NativeRuntime } from "./host";
import { nativeHost } from "./host";

/** A runtime whose ports record what the app sent and answer on demand. */
const fakeRuntime = () => {
  const ports: {
    sent: unknown[];
    answer: (message: unknown) => void;
    hangUp: (error?: string) => void;
  }[] = [];
  const runtime: NativeRuntime = {
    connectNative: (name) => {
      expect(name).toBe("domicile.settings");
      const messages = new Set<(message: unknown) => void>();
      const hangUps = new Set<() => void>();
      const sent: unknown[] = [];
      ports.push({
        answer: (message) => {
          for (const listener of messages) {
            listener(message);
          }
        },
        hangUp: (error) => {
          runtime.lastError =
            error === undefined ? undefined : { message: error };
          for (const listener of hangUps) {
            listener();
          }
        },
        sent,
      });
      const port: NativePort = {
        onDisconnect: {
          addListener: (listener) => hangUps.add(listener),
        },
        onMessage: {
          addListener: (listener) => messages.add(listener),
        },
        postMessage: (message) => {
          sent.push(message);
        },
      };
      return port;
    },
    lastError: undefined,
  };
  return { ports, runtime };
};

const DEFAULTS = {
  camera: "ask",
  clipboard: "ask",
  location: "ask",
  microphone: "ask",
  midi: "ask",
  notifications: "allow",
} as const;

const FILES = {
  config: {
    path: "/home/me/.config/domicile/domicile.json",
    text: "{}",
    writable: true,
  },
  evaluated: null,
  shell: null,
};

describe(nativeHost, () => {
  it("reads the files, matching the reply to its request", async () => {
    const { ports, runtime } = fakeRuntime();
    const host = nativeHost(runtime);
    const read = host.read();
    expect(ports[0]?.sent).toEqual([{ id: 1, type: "read" }]);
    ports[0]?.answer({ id: 1, type: "files", ...FILES });
    expect(await read).toEqual({
      config: FILES.config,
      evaluated: undefined,
      shell: undefined,
    });
  });

  it("rejects with the host's reason when it refuses", async () => {
    const { ports, runtime } = fakeRuntime();
    const write = nativeHost(runtime).write("shell", "x");
    expect(ports[0]?.sent).toEqual([
      { file: "shell", id: 1, text: "x", type: "write" },
    ]);
    ports[0]?.answer({ id: 1, type: "refused", why: "shell.ts is read-only" });
    await expect(write).rejects.toThrow("shell.ts is read-only");
  });

  it("lists and sets site permissions", async () => {
    const { ports, runtime } = fakeRuntime();
    const host = nativeHost(runtime);
    const listed = host.sitePermissions();
    ports[0]?.answer({
      defaults: DEFAULTS,
      id: 1,
      sites: [
        {
          origin: "https://meet.example",
          permission: "camera",
          setting: "allow",
        },
      ],
      type: "site_permissions",
    });
    expect(await listed).toEqual({
      defaults: DEFAULTS,
      sites: [
        {
          origin: "https://meet.example",
          permission: "camera",
          setting: "allow",
        },
      ],
    });

    const site = {
      origin: "https://meet.example",
      permission: "camera",
      setting: "block",
    } as const;
    const stored = host.setSitePermission(site);
    expect(ports[0]?.sent.at(-1)).toEqual({
      id: 2,
      site,
      type: "set_site_permission",
    });
    ports[0]?.answer({ id: 2, type: "stored" });
    await stored;
  });

  it("tells listeners a file changed on disk", async () => {
    const { ports, runtime } = fakeRuntime();
    const host = nativeHost(runtime);
    const changed = new Promise<void>((resolve) => {
      host.onChange(resolve);
    });
    ports[0]?.answer({ type: "changed" });
    await changed;
  });

  it("fails what was asked when the host goes away, and starts it again for the next", async () => {
    const { ports, runtime } = fakeRuntime();
    const host = nativeHost(runtime);
    const read = host.read();
    ports[0]?.hangUp("Specified native messaging host not found.");
    await expect(read).rejects.toThrow(
      "Specified native messaging host not found.",
    );

    const again = host.read();
    expect(ports).toHaveLength(2);
    ports[1]?.answer({ id: 2, type: "files", ...FILES });
    expect((await again).config).toEqual(FILES.config);
  });
});
