import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { writeAsar } from "../asar-fixture";

const MAIN = join(import.meta.dir, "../main.ts");

const MAIN_JS = `
const { app } = require("electron");
app.whenReady().then(() => {
  console.log(JSON.stringify({
    appPath: app.getAppPath(),
    argv: process.argv.slice(1),
    electron: process.versions.electron,
    name: app.getName(),
    resourcesPath: process.resourcesPath,
    type: process.type,
    userData: app.getPath("userData"),
  }));
  app.quit();
});
`;

const run = async (resources: string, home: string, args: string[]) => {
  const child = Bun.spawn(["bun", MAIN, resources, ...args], {
    env: {
      ...env,
      HOME: home,
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    code: await child.exited,
    stderr: await new Response(child.stderr).text(),
    stdout: await new Response(child.stdout).text(),
  };
};

describe("electron-host", () => {
  it("runs the app's main with the stand-in, from its mirror", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-main-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "main.js": { content: MAIN_JS },
      "package.json": {
        content: `{"main":"main.js","name":"notes","productName":"Notes","version":"1.2.3"}`,
      },
    });

    const { code, stdout } = await run(resources, home, ["--open", "x.txt"]);
    const seen = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(seen).toMatchObject({
      argv: ["--open", "x.txt"],
      electron: "45.2.1",
      name: "Notes",
      type: "browser",
      userData: join(home, ".config/Notes"),
    });
    expect(seen.appPath).toStartWith(join(home, ".cache/domicile/electron/"));
    expect(seen.appPath).toBe(join(seen.resourcesPath, "app.asar"));
  });

  it("says why when the app can't be read", async () => {
    const home = await mkdtemp(join(tmpdir(), "electron-host-main-"));
    const resources = join(home, "install/resources");
    await writeAsar(join(resources, "app.asar"), {
      "package.json": { content: `{"name":"notes","version":"1.2.3"}` },
    });
    await writeFile(join(resources, "extra.asar"), "junk");

    const { code, stderr } = await run(resources, home, []);

    expect(code).toBe(1);
    expect(stderr).toContain(
      `${join(resources, "extra.asar")} is not an asar archive`,
    );
  });
});
