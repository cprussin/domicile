import { describe, expect, it } from "bun:test";

import {
  CHROME_FAILURE_CHANNEL,
  failHere,
  orDie,
  orDieStarting,
  reasonFor,
  reportOnce,
  stopOnChromeFailure,
} from "./chrome-failure";

type Failure = [line: string, code: number];

describe("reportOnce", () => {
  it("says why and stops", () => {
    const said: Failure[] = [];
    reportOnce((line, code) => said.push([line, code]))("gone\n", 1);
    expect(said).toStrictEqual([["gone\n", 1]]);
  });

  it("lets only the first failure speak", () => {
    // `app.exit` does not stop an IPC message already queued behind it, so two
    // failures arriving together — a throw at preload scope and the socket
    // error it left in flight — would both reach the terminal, and the second
    // is at best redundant and at worst a wrong account of the first.
    const said: Failure[] = [];
    const fail = reportOnce((line, code) => said.push([line, code]));
    fail("the chrome could not start\n", 1);
    fail("the compositor closed the connection\n", 1);
    expect(said).toStrictEqual([["the chrome could not start\n", 1]]);
  });
});

describe("orDie", () => {
  it("says nothing when the preload starts", () => {
    const said: Failure[] = [];
    orDie(
      (line, code) => said.push([line, code]),
      () => undefined,
    );
    expect(said).toStrictEqual([]);
  });

  it("reports a throw at preload scope", () => {
    // Electron catches one, logs it to a devtools console nobody has open
    // while using a desktop, and loads the page anyway — where the transport
    // is missing and the shell's no-op fallback brings up a permanently deaf
    // desktop.
    const said: Failure[] = [];
    orDie(
      (line, code) => said.push([line, code]),
      () => {
        throw new Error("no socket");
      },
    );
    expect(said).toStrictEqual([
      ["domicile: the chrome could not start: no socket\n", 1],
    ]);
  });

  it("reports something thrown that is not an error", () => {
    const said: Failure[] = [];
    orDie(
      (line, code) => said.push([line, code]),
      () => {
        // Not an `Error`: a preload can be brought down by anything a
        // dependency chose to throw, and the reason still has to read.
        throw "nope";
      },
    );
    expect(said[0]?.[0]).toContain("nope");
  });
});

describe("orDieStarting", () => {
  it("says nothing when the shell starts", async () => {
    const said: Failure[] = [];
    orDieStarting((line, code) => said.push([line, code]), Promise.resolve());
    await Promise.resolve();
    expect(said).toStrictEqual([]);
  });

  it("reports a start that never got its window up", async () => {
    // The outermost arm of a main process, and the one it can least afford to
    // throw from: nothing opened means `window-all-closed` never fires either,
    // so a throw leaves the process up with no window and no way out.
    const said: Failure[] = [];
    orDieStarting(
      (line, code) => said.push([line, code]),
      Promise.reject(new Error("no renderer bundle")),
    );
    await Promise.resolve();
    expect(said).toStrictEqual([
      [
        "domicile: the shell could not open its window: no renderer bundle\n",
        1,
      ],
    ]);
  });

  it("reports a rejection that is not an error", async () => {
    const said: Failure[] = [];
    orDieStarting(
      (line, code) => said.push([line, code]),
      Promise.reject("nope"),
    );
    await Promise.resolve();
    expect(said[0]?.[0]).toContain("nope");
  });
});

describe("reasonFor", () => {
  it("gives an error's message without its class name on the front", () => {
    // `String(error)` would put `Error: ` in the middle of the reason line.
    expect(reasonFor(new Error("no socket"))).toBe("no socket");
  });

  it("reads for something that is not an error", () => {
    // A dependency's string, a rejected `undefined`: the line still has to say
    // something.
    expect(reasonFor("nope")).toBe("nope");
    expect(reasonFor(undefined)).toBe("undefined");
  });
});

describe("failHere", () => {
  it("writes the main process's own reason and stops", () => {
    // Electron pins Node's legacy `--unhandled-rejections=warn`, so a throw in
    // this process warns to a stderr nobody is reading and exits 0. Only an
    // explicit exit gets the failure out.
    // One log rather than two, because the *order* is load-bearing: `app.exit`
    // terminates the process, so a write after it never runs and the reason is
    // lost — the one inversion that silently defeats the whole function.
    const events: string[] = [];

    failHere({
      exit: (code) => events.push(`exit ${code}`),
      write: (line) => events.push(line),
    })("domicile: no renderer\n", 1);

    expect(events).toStrictEqual(["domicile: no renderer\n", "exit 1"]);
  });
});

describe("stopOnChromeFailure", () => {
  it("writes the chrome's reason and exits with its code", () => {
    // The renderer holds the socket, so it is the half that learns the
    // compositor is gone — and it can neither write to stderr nor stop the app.
    const written: string[] = [];
    const exited: number[] = [];
    const listeners = new Map<string, (...args: never[]) => void>();

    stopOnChromeFailure({
      exit: (code) => exited.push(code),
      ipc: {
        on: (channel, listener) => {
          listeners.set(channel, listener as (...args: never[]) => void);
        },
      },
      write: (line) => written.push(line),
    });
    listeners.get(CHROME_FAILURE_CHANNEL)?.(
      ...([undefined, "domicile: gone\n", 3] as never[]),
    );

    expect(written).toStrictEqual(["domicile: gone\n"]);
    expect(exited).toStrictEqual([3]);
  });
});
