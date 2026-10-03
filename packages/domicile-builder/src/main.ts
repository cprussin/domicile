#!/usr/bin/env bun
// `domicile-builder (--entry <file> | --package <spec>) --domicile <install>
// --cache <dir>`: build the entry, or the package's, into a shell module,
// saying each step on stdout as a JSON line.
//
// Only a line that is a JSON object with a `step` is a step: what the tools
// underneath print goes to stdout too — Panda says how long it took — and is
// the build's log, which `domicile` shows as it is.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { importGraph } from "./graph";
import { installedName, packageProject, prebuiltOf } from "./package";
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

/**
 * Install `spec` into a project of its own, and serve the module it ships or
 * build its entry.
 */
const buildPackage = async (
  spec: string,
  domicile: string,
  cache: string,
): Promise<void> => {
  say(Step.Resolving());
  const project = packageProject(cache, spec);
  if (manifestOf(project)?.dependencies === undefined) {
    say(Step.Installing([spec]));
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, "package.json"), "{}\n");
    runBun(project, ["add", "--ignore-scripts", spec]);
  }
  const name = installedName(manifestOf(project) ?? {});
  const installed = path.join(project, "node_modules", name);
  const prebuilt = prebuiltOf(
    readFile(path.join(installed, "package.json")) ?? "{}",
  );
  if (prebuilt === undefined) {
    await build(Bun.resolveSync(name, project), domicile, cache);
  } else {
    const module = path.join(installed, prebuilt);
    say(Step.Built(path.dirname(module), path.basename(module), true));
  }
};

const { values } = parseArgs({
  options: {
    cache: { type: "string" },
    domicile: { type: "string" },
    entry: { type: "string" },
    package: { type: "string" },
  },
});
const { cache, domicile, entry, package: spec } = values;

/** What the arguments ask for, or `undefined` where they ask for nothing. */
const asked = (): Promise<void> | undefined => {
  if (domicile === undefined || cache === undefined) {
    return undefined;
  } else if (entry !== undefined && spec === undefined) {
    return build(
      path.resolve(entry),
      path.resolve(domicile),
      path.resolve(cache),
    );
  } else if (spec !== undefined && entry === undefined) {
    return buildPackage(spec, path.resolve(domicile), path.resolve(cache));
  } else {
    return undefined;
  }
};

const building = asked();
if (building === undefined) {
  say(
    Step.Failed(
      "usage: domicile-builder (--entry <file> | --package <spec>) --domicile <install> --cache <dir>",
    ),
  );
  process.exit(2);
}
await building.catch((failure: unknown) => {
  say(
    Step.Failed(failure instanceof Error ? failure.message : String(failure)),
  );
  process.exit(1);
});
