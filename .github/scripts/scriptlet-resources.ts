// Builds the scriptlets uBlock Origin's lists run in a page, `##+js(...)`, as
// the resources file the engine fetches (`browser.scriptlet_resources`).
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
// which the page's own world reaches the same. scriptlet-resources.sh runs this in CI and
// publishes what it writes; see docs/architecture/AD-BLOCKING.md.
//
// The output is the same for the same checkout: sorted by name, and nothing
// in it but what the checkout says.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Builtin = {
  name: string;
  aliases?: string[];
  fn: (...args: unknown[]) => unknown;
  dependencies?: string[];
  world?: string;
  requiresTrust?: boolean;
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
  `scriptlet-resources: ${resources.length} kept, ${left.length} left out ` +
    `(trusted lists only): ${left.sort().join(" ")}`,
);
