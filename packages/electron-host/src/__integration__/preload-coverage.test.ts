// Every Electron API a preload can reach that the engine's preload doesn't
// do yet, measured on the engine's own bootstrap (kBootstrap in
// electron_preload.cc, run here with stand-ins for its natives) and held
// against `preload-coverage.json`, as coverage.test.ts holds the main
// process: `UPDATE_COVERAGE=1 bun test coverage` updates the list. A gap is
// "absent" (an app finds undefined) or "unsupported" (it throws that it
// doesn't work on Domicile yet). See "Every API" in
// docs/architecture/ELECTRON-APPS.md.

import { describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "node:process";
import { z } from "zod";
import {
  ELECTRON_PRELOAD,
  ELECTRON_PRELOAD_PROCESS,
} from "../electron/surface";
import { CONSTANT, decidedStubs } from "./stubs";

const COVERAGE = join(import.meta.dir, "preload-coverage.json");
const PRELOAD_CC = join(
  import.meta.dir,
  "../../../domicile-engine/src/components/domicile/renderer/electron_preload.cc",
);

/**
 * What electron.d.ts puts on `process` that a renderer on Linux doesn't
 * have in Electron either, with why.
 */
const NOT_IN_A_RENDERER: Record<string, string> = {
  chrome: "it is process.versions.chrome, checked below",
  defaultApp: "only the main process has it",
  electron: "it is process.versions.electron, checked below",
  mas: "undefined outside Mac App Store builds",
  parentPort: "only a utility process has it",
  windowsStore: "undefined outside Windows Store builds",
};

/** What a preload's `process` has from Node, in Electron's sandbox too. */
const FROM_NODE = ["arch", "argv", "env", "execPath", "platform", "versions"];

/** The bootstrap's source, as the engine compiles it. */
const bootstrapSource = async () => {
  const source = await readFile(PRELOAD_CC, "utf8");
  const found = /kBootstrap\[\] = R"JS\(([\s\S]*?)\)JS";/.exec(source)?.[1];
  if (found === undefined) {
    throw new Error(`${PRELOAD_CC} has no kBootstrap raw string`);
  }
  return found;
};

/** An object's members, as the walk reads them. */
const Members = z.record(z.string(), z.unknown());

/** What a sandboxed preload is handed: its electron module and process. */
const PreloadGot = z.object({
  electron: z.record(z.string(), Members),
  process: Members.and(z.object({ versions: Members })),
});

/** What a preload gets from the bootstrap: its electron and its process. */
const preloadGets = async () => {
  const bootstrap: unknown = (0, eval)(await bootstrapSource());
  if (typeof bootstrap !== "function") {
    throw new Error("kBootstrap is not a function");
  }
  // Each native answers with its own name, which nothing here reads.
  const natives = new Proxy(
    {},
    { get: (_target, name) => () => `native ${String(name)}` },
  );
  const got: unknown[] = [];
  bootstrap(
    natives,
    (require: (name: string) => unknown, process: unknown) => {
      got.push({ electron: require("electron"), process });
    },
    true,
    {
      arch: "x64",
      argv: ["/engine/chrome", "--a-switch"],
      chromeVersion: "160.0.0.0",
      frameToken: "token",
      routingId: 1,
    },
  );
  if (got.length !== 1) {
    throw new Error(`the bootstrap ran the preload ${got.length} times`);
  }
  return PreloadGot.parse(got[0]);
};

const UNSUPPORTED = /does not work on Domicile yet/;

describe("Electron preload coverage", () => {
  it("is what preload-coverage.json lists", async () => {
    const { electron, process } = await preloadGets();
    const gaps: string[] = [];
    const stubs: string[] = [];
    const walk =
      (owner: string, value: Record<string, unknown> | undefined) =>
      (name: string) => {
        const member = value?.[name];
        if (member === undefined) {
          gaps.push(`${owner}.${name} absent`);
        } else if (typeof member === "function") {
          const source = Function.prototype.toString.call(member);
          if (UNSUPPORTED.test(source)) {
            gaps.push(`${owner}.${name} unsupported`);
          } else if (CONSTANT.test(source)) {
            stubs.push(`preload ${owner}.${name}`);
          }
        }
      };
    for (const [name, { methods, properties }] of Object.entries(
      ELECTRON_PRELOAD,
    )) {
      if (electron[name] === undefined) {
        gaps.push(`${name} absent`);
      } else {
        [...methods, ...properties].forEach(walk(name, electron[name]));
      }
    }
    [
      ...ELECTRON_PRELOAD_PROCESS.methods,
      ...ELECTRON_PRELOAD_PROCESS.properties,
      ...FROM_NODE,
    ]
      .filter((name) => !(name in NOT_IN_A_RENDERER))
      .forEach(walk("process", process));
    ["chrome", "electron"].forEach(walk("process.versions", process.versions));
    gaps.sort();

    // biome-ignore lint/style/noProcessEnv: how a developer updates the list
    if (env.UPDATE_COVERAGE === "1") {
      await writeFile(COVERAGE, `${JSON.stringify(gaps, null, 2)}\n`);
    }
    expect(gaps).toEqual(JSON.parse(await readFile(COVERAGE, "utf8")));
    const decided = await decidedStubs(true);
    expect(stubs.sort()).toEqual([...decided.lies, ...decided.honest].sort());
  });
});
