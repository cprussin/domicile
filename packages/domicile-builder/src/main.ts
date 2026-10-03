#!/usr/bin/env bun
// `domicile-builder --entry <file> --domicile <install> --cache <dir>`: build
// the entry into a shell module, saying each step on stdout as a JSON line.
//
// Only a line that is a JSON object with a `step` is a step: what the tools
// underneath print goes to stdout too — Panda says how long it took — and is
// the build's log, which `domicile` shows as it is.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { importGraph } from "./graph";
import { line, Step } from "./progress";
import type { Manifest } from "./project";
import { cacheKey, missingPackages, parseManifest, projectOf } from "./project";

/** The module every build is, in the directory it is served from. */
const MODULE = "shell.js";

const say = (step: Step): void => {
  process.stdout.write(`${line(step)}\n`);
};

/** A file's text, or `undefined` where there is no file. */
const readFile = (file: string): string | undefined =>
  existsSync(file) && statSync(file).isFile()
    ? readFileSync(file, "utf8")
    : undefined;

/** Run bun with `args` in `cwd`, and throw with what it said if it fails. */
const runBun = (cwd: string, args: readonly string[]): void => {
  const ran = Bun.spawnSync([process.execPath, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (ran.exitCode !== 0) {
    throw new Error(
      `domicile-builder: \`bun ${args.join(" ")}\` in ${cwd} failed:\n${ran.stderr.toString()}`,
    );
  }
};

/** The project's `package.json`, or `undefined` where it has none. */
const manifestOf = (project: string): Manifest | undefined => {
  const text = readFile(path.join(project, "package.json"));
  return text === undefined ? undefined : parseManifest(text);
};

const build = async (
  entry: string,
  domicile: string,
  cache: string,
): Promise<void> => {
  say(Step.Resolving());
  const graph = importGraph(entry, readFile);
  const project = projectOf(entry, existsSync);
  const missing = missingPackages(graph.packages, manifestOf(project));
  if (missing.length > 0) {
    say(Step.Installing(missing));
    runBun(project, ["add", "--ignore-scripts", ...missing]);
  }
  const key = cacheKey(
    graph.files,
    readFile(path.join(project, "bun.lock")) ?? "",
    domicile,
  );
  const root = path.join(cache, key);
  if (readFile(path.join(root, MODULE)) === undefined) {
    if (manifestOf(project)?.dependencies !== undefined) {
      runBun(project, ["install", "--ignore-scripts", "--frozen-lockfile"]);
    }
    say(Step.Bundling());
    // Imported here rather than at the top: vite and Panda take most of a
    // second to load, and a build already in the cache needs neither.
    const { bundle } = await import("./bundle");
    await bundle(entry, root, domicile);
    say(Step.Built(root, MODULE, false));
  } else {
    say(Step.Built(root, MODULE, true));
  }
};

const { values } = parseArgs({
  options: {
    cache: { type: "string" },
    domicile: { type: "string" },
    entry: { type: "string" },
  },
});
const { cache, domicile, entry } = values;
if (entry === undefined || domicile === undefined || cache === undefined) {
  say(
    Step.Failed(
      "usage: domicile-builder --entry <file> --domicile <install> --cache <dir>",
    ),
  );
  process.exit(2);
}
await build(
  path.resolve(entry),
  path.resolve(domicile),
  path.resolve(cache),
).catch((failure: unknown) => {
  say(
    Step.Failed(failure instanceof Error ? failure.message : String(failure)),
  );
  process.exit(1);
});
