import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Resolver } from "./module-hooks";
import { createRegisterHooks, filesImportingHooks } from "./module-hooks";

/** A `require` resolver that answers every package from /pkgs. */
const fakeResolver = (): Resolver => ({
  _resolveFilename: (request) =>
    request.startsWith("node:") ? request : `/pkgs/${request}.js`,
});

describe("module.registerHooks", () => {
  it("runs a resolve hook for require, ahead of the resolver it had", () => {
    const resolver = fakeResolver();
    const seen: unknown[] = [];
    createRegisterHooks(
      resolver,
      () => undefined,
    )({
      resolve: (specifier, context, next) => {
        seen.push({ context, specifier });
        return specifier === "fs"
          ? { shortCircuit: true, url: "node:original-fs" }
          : next(specifier);
      },
    });

    const parent = { filename: "/app/main.js" };
    expect(resolver._resolveFilename("left-pad", parent, false)).toBe(
      "/pkgs/left-pad.js",
    );
    expect(resolver._resolveFilename("node:fs", parent, false)).toBe("node:fs");
    // Bun knows Electron's fs without asar only by its bare name.
    expect(resolver._resolveFilename("fs", parent, false)).toBe("original-fs");
    expect(seen[0]).toEqual({
      context: {
        conditions: ["require", "node", "module-sync", "node-addons"],
        importAttributes: {},
        parentURL: pathToFileURL("/app/main.js").href,
      },
      specifier: "left-pad",
    });
  });

  it("puts the resolver back on deregister", () => {
    const resolver = fakeResolver();
    const registered = createRegisterHooks(
      resolver,
      () => undefined,
    )({
      resolve: () => ({ url: "file:///elsewhere.js" }),
    });

    registered.deregister();

    expect(resolver._resolveFilename("a", undefined, false)).toBe("/pkgs/a.js");
  });

  it("says the app's imports don't pass through its resolve hook", () => {
    const said: string[] = [];
    createRegisterHooks(fakeResolver(), (why) => said.push(why))({
      resolve: (specifier, _context, next) => next(specifier),
    });

    expect(said).toEqual([
      "module.registerHooks resolve hooks run for require only: the app's imports resolve as Bun resolves them",
    ]);
  });

  it("refuses a load hook", () => {
    expect(() =>
      createRegisterHooks(
        fakeResolver(),
        () => undefined,
      )({
        load: () => undefined,
      }),
    ).toThrow("module.registerHooks load hooks don't run");
  });
});

describe("filesImportingHooks", () => {
  it("finds the scripts that import registerHooks, through the mirror's links, and keeps the list", async () => {
    const root = await mkdtemp(join(tmpdir(), "module-hooks-"));
    const install = join(root, "install/app");
    await mkdir(join(install, "out"), { recursive: true });
    await writeFile(
      join(install, "out/main.js"),
      `import{createRequire as a,registerHooks as b}from"node:module";b({});`,
    );
    await writeFile(
      join(install, "out/other.js"),
      `// mentions registerHooks only\nmodule.exports = require("node:module");`,
    );
    const mirror = join(root, "mirror/resources");
    await mkdir(join(mirror, "app.asar"), { recursive: true });
    await writeFile(
      join(mirror, "app.asar/index.mjs"),
      `import { registerHooks } from 'module';`,
    );
    await symlink(install, join(mirror, "app"));
    await writeFile(join(mirror, "icon.png"), "png");

    const found = await filesImportingHooks(mirror);

    expect(found.toSorted()).toEqual([
      join(install, "out/main.js"),
      join(mirror, "app.asar/index.mjs"),
    ]);
    expect(
      JSON.parse(
        await readFile(join(root, "mirror/module-hooks.json"), "utf8"),
      ),
    ).toEqual(found);
  });
});
