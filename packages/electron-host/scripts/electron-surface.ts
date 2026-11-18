// Writes `src/electron/surface.ts`: every module, method and property a
// Linux Electron app can reach in the main process, from the `electron.d.ts`
// of the Electron that `src/electron/version.ts` names and of the newest
// release of each of the `MAJORS` majors before it, since an app built on an
// older Electron calls what that one had.
//
//   bun scripts/electron-surface.ts
//
// `surface.test.ts` holds the host's `electron` to it, so an app can never
// again find a plain `undefined` where Electron has an API. See "Every API"
// in docs/architecture/ELECTRON-APPS.md.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ELECTRON_VERSION } from "../src/electron/version";

/** Electron's modules for Linux, as `lib/browser/api/module-list.ts` has them. */
const NOT_ON_LINUX = new Set([
  "inAppPurchase",
  "pushNotifications",
  "ShareMenu",
]);

/** Members every EventEmitter has, which `node:events` gives. */
const EMITTER = new Set([
  "addListener",
  "emit",
  "off",
  "on",
  "once",
  "removeAllListeners",
  "removeListener",
]);

/** How many majors before `ELECTRON_VERSION`'s the surface covers too. */
const MAJORS = 12;

/** `ELECTRON_VERSION`, and the newest stable release of each major before it. */
const versions = async () => {
  const response = await fetch("https://registry.npmjs.org/electron");
  if (!response.ok) {
    throw new Error(`npm answered ${response.status} for electron's releases`);
  }
  const { versions: all } = (await response.json()) as {
    versions: Record<string, unknown>;
  };
  const major = Number(ELECTRON_VERSION.split(".")[0]);
  const newest = new Map<number, string>();
  const order = (version: string) => version.split(".").map(Number);
  for (const version of Object.keys(all)) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      continue;
    }
    const [m = 0] = order(version);
    if (m >= major - MAJORS && m < major) {
      const best = newest.get(m);
      const newer =
        best === undefined ||
        order(version).some((part, i) => {
          const other = order(best)[i] ?? 0;
          return (
            part !== other &&
            part > other &&
            order(version)
              .slice(0, i)
              .every((p, j) => p === (order(best)[j] ?? 0))
          );
        });
      if (newer) {
        newest.set(m, version);
      }
    }
  }
  return [
    ELECTRON_VERSION,
    ...[...newest.entries()].sort(([a], [b]) => b - a).map(([, v]) => v),
  ];
};

const fetchTypes = async (version: string) => {
  const dir = await mkdtemp(join(tmpdir(), "electron-surface-"));
  const tarball = join(dir, "electron.tgz");
  const response = await fetch(
    `https://registry.npmjs.org/electron/-/electron-${version}.tgz`,
  );
  if (!response.ok) {
    throw new Error(`npm answered ${response.status} for electron ${version}`);
  }
  await writeFile(tarball, new Uint8Array(await response.arrayBuffer()));
  const tar = Bun.spawnSync([
    "tar",
    "-xzf",
    tarball,
    "-C",
    dir,
    "package/electron.d.ts",
  ]);
  if (tar.exitCode !== 0) {
    throw new Error(`tar failed: ${tar.stderr.toString()}`);
  }
  return readFile(join(dir, "package/electron.d.ts"), "utf8");
};

/** The text of the block that `header` opens, up to its closing brace. */
const block = (types: string, header: string) => {
  const start = types.indexOf(`\n  ${header}`);
  if (start === -1) {
    throw new Error(`electron.d.ts has no ${header}`);
  }
  return types.slice(start, types.indexOf("\n  }\n", start));
};

/**
 * A module's members: on Linux, and the methods Electron has only elsewhere,
 * which it leaves on Linux as calls that do nothing.
 */
type Members = { methods: string[]; properties: string[]; elsewhere: string[] };

/**
 * The members a block declares for Linux, `static` ones or the rest. A
 * member's platforms are in the `@platform` of the comment right before its
 * first declaration.
 */
const membersOf = (text: string, statics: boolean): Members => {
  const methods = new Set<string>();
  const properties = new Set<string>();
  const notLinux = new Set<string>();
  const elsewhere = new Set<string>();
  const seen = new Set<string>();
  const pattern = statics
    ? /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?\n {4}static (?:readonly )?(\w+)(\(|\??:)/g
    : /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?\n {4}(?:readonly )?(\w+)(\(|\??:)/g;
  for (const [, doc = "", name = "", kind] of text.matchAll(pattern)) {
    if (EMITTER.has(name) || name === "constructor") {
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      const platforms = /@platform ([\w,]+)/.exec(doc)?.[1];
      if (platforms !== undefined && !platforms.split(",").includes("linux")) {
        notLinux.add(name);
      }
    }
    if (notLinux.has(name)) {
      if (kind === "(") {
        elsewhere.add(name);
      }
      continue;
    }
    (kind === "(" ? methods : properties).add(name);
  }
  return {
    elsewhere: [...elsewhere].filter((name) => !methods.has(name)).sort(),
    methods: [...methods].sort(),
    properties: [...properties].sort(),
  };
};

/** The classes whose objects an app gets, and the one each extends. */
const INSTANCES: Record<string, string | undefined> = {
  BaseWindow: undefined,
  BrowserView: undefined,
  BrowserWindow: "BaseWindow",
  Cookies: undefined,
  Debugger: undefined,
  DownloadItem: undefined,
  Menu: undefined,
  MenuItem: undefined,
  MessagePortMain: undefined,
  NativeImage: undefined,
  NavigationHistory: undefined,
  Notification: undefined,
  ServiceWorkers: undefined,
  Session: undefined,
  Tray: undefined,
  UtilityProcess: undefined,
  View: undefined,
  WebContents: undefined,
  WebContentsView: "View",
  WebFrameMain: undefined,
  WebRequest: undefined,
};

const merge = (known: Members | undefined, found: Members): Members =>
  known === undefined
    ? found
    : {
        elsewhere: [
          ...new Set([...known.elsewhere, ...found.elsewhere]),
        ].sort(),
        methods: [...new Set([...known.methods, ...found.methods])].sort(),
        properties: [
          ...new Set([...known.properties, ...found.properties]),
        ].sort(),
      };

const instances: Record<string, Members> = {};
const surface: Record<string, Members & { kind: "object" | "class" }> = {};
const covered = await versions();
for (const version of covered) {
  const types = await fetchTypes(version);
  for (const [name, parent] of Object.entries(INSTANCES)) {
    let found = membersOf(block(types, `class ${name} `), false);
    if (parent !== undefined) {
      found = merge(found, membersOf(block(types, `class ${parent} `), false));
    }
    instances[name] = merge(instances[name], found);
  }
  for (const [name, found] of Object.entries(surfaceOf(types))) {
    const known = surface[name];
    surface[name] =
      known === undefined
        ? found
        : {
            elsewhere: [
              ...new Set([...known.elsewhere, ...found.elsewhere]),
            ].sort(),
            kind: known.kind,
            methods: [...new Set([...known.methods, ...found.methods])].sort(),
            properties: [
              ...new Set([...known.properties, ...found.properties]),
            ].sort(),
          };
  }
}

function surfaceOf(types: string) {
  const exports = [
    ...block(types, "namespace Main {").matchAll(
      /\n {4}(const|class) (\w+): ?(typeof )?(\w+)?/g,
    ),
    ...block(types, "namespace Main {").matchAll(
      /\n {4}(class) (\w+) extends Electron\.(\w+)/g,
    ),
    ...block(types, "namespace Common {").matchAll(
      /\n {4}(const|class) (\w+): ?(typeof )?(\w+)?/g,
    ),
    ...block(types, "namespace Common {").matchAll(
      /\n {4}(class) (\w+) extends Electron\.(\w+)/g,
    ),
  ];
  const surface: Record<string, Members & { kind: "object" | "class" }> = {};
  for (const match of exports) {
    const [, keyword, name = ""] = match;
    if (NOT_ON_LINUX.has(name) || name in surface) {
      continue;
    }
    if (keyword === "const" && match[3] === undefined) {
      // `const app: App`: an object with the interface's members.
      const iface = match[4] ?? "";
      const text = types.includes(`\n  interface ${iface} `)
        ? block(types, `interface ${iface} `)
        : block(types, `class ${iface} `);
      surface[name] = { kind: "object", ...membersOf(text, false) };
    } else if (keyword === "const") {
      // `const session: typeof Session`: the class's statics.
      surface[name] = {
        kind: "object",
        ...membersOf(block(types, `class ${match[4]} `), true),
      };
    } else {
      surface[name] = {
        kind: "class",
        ...membersOf(block(types, `class ${name} `), true),
      };
    }
  }
  return surface;
}

const sorted = Object.fromEntries(
  Object.entries(surface).sort(([a], [b]) => a.localeCompare(b)),
);
await writeFile(
  join(import.meta.dir, "../src/electron/surface.ts"),
  `// GENERATED by scripts/electron-surface.ts from the electron.d.ts of Electron
// ${covered.join(", ")}.
// Run it again after moving \`ELECTRON_VERSION\`; don't edit this.
//
// Every module a Linux Electron app can require in its main process, and for
// each its methods and properties on Linux, an object's own or a class's
// statics, and the methods it has only on macOS or Windows (\`elsewhere\`).

export const ELECTRON_SURFACE = ${JSON.stringify(sorted, null, 2)} as const;

// The members of the objects an app gets: its windows, pages, sessions and
// the rest, with what each class extends.
export const ELECTRON_INSTANCES = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(instances).sort(([a], [b]) => a.localeCompare(b)),
    ),
    null,
    2,
  )} as const;
`,
);
