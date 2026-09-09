import { describe, expect, it } from "bun:test";
import path from "node:path";

import { shellFromEnvironment } from "./shell-from-env";

/** A refusal that can be caught, since the real one ends the process. */
class Refused extends Error {}
const refuse = (message: string): never => {
  throw new Refused(message);
};

const there = () => Promise.resolve(true);
const notThere = () => Promise.resolve(false);

describe("shellFromEnvironment", () => {
  it("serves a module from the directory it is in", async () => {
    // The whole of what makes a shell one file: the directory is what gets
    // served, and the document names the module by its basename because that
    // is what a browser resolves against the document's own URL.
    expect(
      await shellFromEnvironment(
        { module: "/home/me/desktop/dist/shell.js" },
        there,
        refuse,
      ),
    ).toStrictEqual({ module: "shell.js", root: "/home/me/desktop/dist" });
  });

  it("takes the basename, not the path it was given", async () => {
    // The failure this rules out: serving the *absolute* path as the module
    // makes the document name `/home/me/…/shell.js`, which the browser asks
    // for as an absolute URL — outside the served root, so a 404 and a blank
    // desktop.
    const shell = await shellFromEnvironment(
      { module: "/home/me/desktop/dist/shell.js" },
      there,
      refuse,
    );

    expect(shell.module).not.toContain("/");
  });

  it("resolves a relative module against the working directory", async () => {
    const shell = await shellFromEnvironment(
      { module: "./dist/shell.js" },
      there,
      refuse,
    );

    expect(shell.module).toBe("shell.js");
    expect(shell.root).toBe(path.resolve("dist"));
  });

  it("serves the module's own directory, not its parent", async () => {
    // A root one level up would serve the whole project — the source, the
    // lockfile, whatever else is beside `dist` — over HTTP to the desktop.
    const shell = await shellFromEnvironment(
      { module: "/home/me/desktop/dist/shell.js" },
      there,
      refuse,
    );

    expect(shell.root).toBe("/home/me/desktop/dist");
    expect(shell.root).not.toBe("/home/me/desktop");
  });

  it("refuses a module that is not there, and names it", async () => {
    // Rather than serving a document that names a script nothing can fetch,
    // which is a blank desktop and no reason anywhere.
    await expect(
      shellFromEnvironment({ module: "/home/me/gone.js" }, notThere, refuse),
    ).rejects.toThrow("there is no module at /home/me/gone.js");
  });

  it("refuses a shell that was not named at all", async () => {
    await expect(shellFromEnvironment({}, there, refuse)).rejects.toThrow(
      "DOMICILE_MODULE is required",
    );
  });
});
