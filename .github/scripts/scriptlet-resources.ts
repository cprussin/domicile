// Builds the scriptlets uBlock Origin's lists run in a page, `##+js(...)`, and
// the stand-ins their `$redirect` rules answer a request with, as the
// resources file the engine fetches (`browser.scriptlet_resources`).
//
//   bun .github/scripts/scriptlet-resources.ts <uBlock checkout> <out.json>
//
// uBlock Origin keeps them as functions in src/js/resources/, registered in
// scriptlets.js's `builtinScriptlets`; each becomes an adblock-rust resource,
// its source in base64, so the engine calls it by name with the rule's
// arguments. Those that need a trusted list (`requiresTrust`), which Domicile
// does not have, are left out. Those uBlock Origin runs in its isolated world
// (`world: "ISOLATED"`), such as `remove-class` and `set-cookie`, which the
// cookie lists use to let a page scroll again, run in the page's world here,
// as Brave runs them: they only touch the page's DOM, cookies and storage,
// which the page's own world reaches the same.
//
// The stand-ins are the files of src/web_accessible_resources/ that
// src/js/redirect-resources.js names, each by its name and aliases, its type
// by its extension, as adblock-rust's own resource assembler reads them. Those
// that need a trusted list, or parameters uBlock Origin fills in
// (`click2load.html`), are left out.
//
// scriptlet-resources.sh runs this in CI and publishes what it writes; see
// docs/architecture/AD-BLOCKING.md.
//
// The output is the same for the same checkout: sorted by name, and nothing
// in it but what the checkout says.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Builtin = {
  name: string;
  aliases?: string[];
  fn: (...args: unknown[]) => unknown;
  dependencies?: string[];
  world?: string;
  requiresTrust?: boolean;
};

type Redirect = {
  alias?: string | string[];
  params?: string[];
  requiresTrust?: boolean;
};

// A stand-in's type by its extension, as adblock-rust's assembler has it.
const MIME: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".mp3": "audio/mp3",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".txt": "text/plain",
  ".xml": "text/xml",
  "": "text/plain",
};

type Resource = {
  name: string;
  aliases: string[];
  kind: { mime: string };
  content: string;
  dependencies: string[];
};

const fail = (message: string): never => {
  console.error(`scriptlet-resources: ${message}`);
  process.exit(1);
};

const [checkout, out] = process.argv.slice(2);
if (checkout === undefined || out === undefined) {
  fail("usage: scriptlet-resources.ts <uBlock checkout> <out.json>");
}

const at = join(resolve(checkout!), "src/js/resources/scriptlets.js");
const { builtinScriptlets } = (await import(pathToFileURL(at).href)) as {
  builtinScriptlets?: Builtin[];
};
if (!Array.isArray(builtinScriptlets) || builtinScriptlets.length === 0) {
  fail(`${at} exports no builtinScriptlets: uBlock Origin moved them`);
}

const kept = new Map<string, Resource>();
const left: string[] = [];
for (const builtin of builtinScriptlets!) {
  if (typeof builtin.name !== "string" || typeof builtin.fn !== "function") {
    fail(
      `an entry of builtinScriptlets has no name or fn: ${JSON.stringify(builtin)}`,
    );
  }
  if (builtin.requiresTrust === true) {
    left.push(builtin.name);
    continue;
  }
  if (kept.has(builtin.name)) fail(`${builtin.name} is registered twice`);
  kept.set(builtin.name, {
    name: builtin.name,
    aliases: [...(builtin.aliases ?? [])].sort(),
    kind: {
      mime: builtin.name.endsWith(".fn")
        ? "fn/javascript"
        : "application/javascript",
    },
    content: Buffer.from(builtin.fn.toString(), "utf8").toString("base64"),
    dependencies: [...(builtin.dependencies ?? [])],
  });
}

const scriptlets = kept.size;
const redirectsAt = join(resolve(checkout!), "src/js/redirect-resources.js");
const { default: redirects } = (await import(
  pathToFileURL(redirectsAt).href
)) as { default?: Map<string, Redirect> };
if (!(redirects instanceof Map) || redirects.size === 0) {
  fail(
    `${redirectsAt} exports no Map of redirect resources: uBlock Origin moved them`,
  );
}
const leftRedirects: string[] = [];
for (const [name, redirect] of redirects!) {
  if (redirect.requiresTrust === true || (redirect.params ?? []).length > 0) {
    leftRedirects.push(name);
    continue;
  }
  const mime = MIME[extname(name)];
  if (mime === undefined) {
    fail(`${name} has a type adblock-rust does not serve`);
  }
  const file = join(resolve(checkout!), "src/web_accessible_resources", name);
  if (!existsSync(file)) fail(`${name} is named but ${file} is not there`);
  if (kept.has(name)) fail(`${name} is both a scriptlet and a stand-in`);
  const alias = redirect.alias ?? [];
  kept.set(name, {
    name,
    aliases: (typeof alias === "string" ? [alias] : [...alias]).sort(),
    kind: { mime: mime! },
    content: readFileSync(file).toString("base64"),
    dependencies: [],
  });
}

// A scriptlet whose helper was left out would throw in every page it runs in.
for (const resource of kept.values()) {
  for (const dependency of resource.dependencies) {
    if (!kept.has(dependency)) {
      fail(`${resource.name} depends on ${dependency}, which is not kept`);
    }
  }
}

const resources = [...kept.values()].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
);
writeFileSync(out!, `${JSON.stringify(resources, null, 1)}\n`);
console.log(
  `scriptlet-resources: ${scriptlets} scriptlets kept, ${left.length} left out ` +
    `(trusted lists only): ${left.sort().join(" ")}; ` +
    `${resources.length - scriptlets} stand-ins kept, ${leftRedirects.length} ` +
    `left out (trusted lists or parameters): ${leftRedirects.sort().join(" ")}`,
);
