import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { launchShell } from "../launch-shell";

/** A directory holding this test's stand-ins and whatever they record. */
const scratch = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "domicile-launch-"));

const script = async (
  directory: string,
  name: string,
  body: string,
): Promise<string> => {
  const program = path.join(directory, name);
  await writeFile(program, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return program;
};

/** A compositor that comes up, publishes, and then waits to be stopped. */
const COMPOSITOR = `
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --chrome-socket) CHROME_SOCKET="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat >"$SESSION.new" <<JSON
{ "protocol": 17, "chrome_socket": "$CHROME_SOCKET",
  "wayland_display": "wayland-stand-in",
  "chrome_wayland_display": "wayland-stand-in-chrome",
  "composited": true }
JSON
mv "$SESSION.new" "$SESSION"
while true; do sleep 1; done
`;

describe("launchShell", () => {
  it("starts the chrome inside the compositor it started", async () => {
    const directory = await scratch();
    const seen = path.join(directory, "seen");
    const code = await launchShell({
      compositor: await script(directory, "compositor", COMPOSITOR),
      electron: await script(
        directory,
        "electron",
        `{ echo "$WAYLAND_DISPLAY"; echo "$DOMICILE_SESSION"; echo "$*"; } >"${seen}"\nexit 7`,
      ),
      main: "/shell/main.js",
      present: true,
    });

    // The chrome's exit is the shell's exit: it is the program the user ran.
    expect(code).toBe(7);
    const [display, session, args] = (await readFile(seen, "utf8")).split("\n");
    expect(display).toBe("wayland-stand-in-chrome");
    expect(JSON.parse(session ?? "").wayland_display).toBe("wayland-stand-in");
    expect(args).toContain("--ozone-platform=wayland");
    expect(args).toContain("/shell/main.js");
  });

  it("says why when the compositor will not come up", async () => {
    const directory = await scratch();
    await expect(
      launchShell({
        compositor: await script(
          directory,
          "compositor",
          'echo "no display to open" >&2\nexit 3',
        ),
        electron: await script(directory, "electron", "exit 0"),
        main: "/shell/main.js",
        present: true,
      }),
    ).rejects.toThrow("no display to open");
  });
});
