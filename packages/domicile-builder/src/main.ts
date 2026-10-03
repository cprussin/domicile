#!/usr/bin/env bun
// `domicile-builder (--entry <file> | --package <spec> | --evaluate <config>)
// --domicile <install> --cache <dir>`: build the entry, or the package's, into
// a shell module — or evaluate a config module into the compositor's JSON —
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

/**
 * The entry's files, and its project with every package it imports
 * installed: what a build and an evaluation both start from.
 */
const prepared = (entry: string) => {
  say(Step.Resolving());
  const graph = importGraph(entry, readFile);
  const project = projectOf(entry, existsSync);
  const missing = missingPackages(graph.packages, manifestOf(project));
  if (missing.length > 0) {
    say(Step.Installing(missing));
    runBun(project, ["add", "--ignore-scripts", ...missing]);
  }
  return { graph, project };
};

/** The key of a build or an evaluation of what `prepared` read. */
const keyOf = (
  { graph, project }: ReturnType<typeof prepared>,
  domicile: string,
): string =>
  cacheKey(
    graph.files,
    readFile(path.join(project, "bun.lock")) ?? "",
    domicile,
  );

/** Install what `project` lists, when it lists anything. */
const installed = (project: string): void => {
  if (manifestOf(project)?.dependencies !== undefined) {
    runBun(project, ["install", "--ignore-scripts", "--frozen-lockfile"]);
  }
};

const build = async (
  entry: string,
  domicile: string,
  cache: string,
): Promise<void> => {
  const read = prepared(entry);
  const root = path.join(cache, keyOf(read, domicile));
  if (readFile(path.join(root, MODULE)) === undefined) {
    installed(read.project);
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

/** Evaluate the config module `config` into the JSON the compositor reads. */
const evaluateConfig = async (
  config: string,
  domicile: string,
  cache: string,
): Promise<void> => {
  const read = prepared(config);
  const out = path.join(cache, "configs", `${keyOf(read, domicile)}.json`);
  if (readFile(out) === undefined) {
    installed(read.project);
    mkdirSync(path.dirname(out), { recursive: true });
    const { evaluate } = await import("./evaluate");
    await evaluate(config, out, domicile);
    say(Step.Evaluated(out, false));
  } else {
    say(Step.Evaluated(out, true));
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
    evaluate: { type: "string" },
    package: { type: "string" },
  },
});
const { cache, domicile, entry, evaluate: config, package: spec } = values;

/** What the arguments ask for, or `undefined` where they ask for nothing. */
const asked = (): Promise<void> | undefined => {
  const asking = [entry, spec, config].filter((one) => one !== undefined);
  if (domicile === undefined || cache === undefined || asking.length !== 1) {
    return undefined;
  } else if (config !== undefined) {
    return evaluateConfig(
      path.resolve(config),
      path.resolve(domicile),
      path.resolve(cache),
    );
  } else if (entry !== undefined) {
    return build(
      path.resolve(entry),
      path.resolve(domicile),
      path.resolve(cache),
    );
  } else if (spec === undefined) {
    return undefined;
  } else {
    return buildPackage(spec, path.resolve(domicile), path.resolve(cache));
  }
};

const building = asked();
if (building === undefined) {
  say(
    Step.Failed(
      "usage: domicile-builder (--entry <file> | --package <spec> | --evaluate <config>) --domicile <install> --cache <dir>",
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
