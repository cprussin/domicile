// Writes `src/domicile-host.ts` from the engine's WebIDL.
//
//   bun run generate              # in packages/chrome-sdk
//   bun codegen/generate-domicile-host.ts <path>   # somewhere else
//
// `scripts/test-host-types-match-the-idl.sh` checks the file is current.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Idl } from "./parse-webidl";
import { parseWebIdl } from "./parse-webidl";
import { webIdlToTypeScript } from "./webidl-to-typescript";

const ROOT = path.resolve(import.meta.dir, "../../..");
const IDL_DIR = path.join(
  ROOT,
  "packages/domicile-engine/src/third_party/blink/renderer/modules/domicile",
);
const TARGET = path.join(ROOT, "packages/chrome-sdk/src/domicile-host.ts");
const BIOME = path.join(ROOT, "node_modules/.bin/biome");

const HEADER = [
  "Generated from the engine's WebIDL by `codegen/generate-domicile-host.ts`.",
  "Do not edit. Change the IDL in",
  "`packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`",
  "and run `bun run generate` in `packages/chrome-sdk`.",
  "",
  "The desktop a shell is handed (`Shell(root, domicile)`). There is no global;",
  "a shell keeps what it was handed. See `shell.ts`.",
  "",
  "Sizes and coordinates are fractional CSS pixels, except in `DomicileDisplay`.",
  "Keycodes are Linux evdev codes.",
];

/** What each event is dispatched as, which `EventHandler` does not say. */
const EVENT_TYPES = {
  focusrequested: "DomicileAppEvent",
  portalrequests: "MessageEvent<string>",
  shortcut: "DomicileShortcutEvent",
  system: "MessageEvent<string>",
};

const generate = (out: string): void => {
  const idl = readdirSync(IDL_DIR)
    .filter((name) => name.endsWith(".idl"))
    .sort()
    .map((name) => parseIdlFile(path.join(IDL_DIR, name)))
    .reduce(mergeIdl);
  const typescript = webIdlToTypeScript(idl, {
    eventTypes: EVENT_TYPES,
    header: HEADER,
  });
  writeFileSync(out, format(typescript));
};

const parseIdlFile = (file: string): Idl => {
  try {
    return parseWebIdl(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`failed to parse ${file}`, { cause: error });
  }
};

const mergeIdl = (a: Idl, b: Idl): Idl => ({
  dictionaries: [...a.dictionaries, ...b.dictionaries],
  enums: [...a.enums, ...b.enums],
  interfaces: [...a.interfaces, ...b.interfaces],
});

/** Biome's formatting, as `biome check` wants it for the target's path. */
const format = (typescript: string): string => {
  const biome = Bun.spawnSync(
    [BIOME, "format", `--stdin-file-path=${TARGET}`],
    {
      cwd: ROOT,
      stdin: new TextEncoder().encode(typescript),
    },
  );
  if (biome.exitCode === 0) {
    return biome.stdout.toString();
  } else {
    throw new Error(`biome format failed: ${biome.stderr.toString()}`);
  }
};

generate(process.argv[2] ?? TARGET);
