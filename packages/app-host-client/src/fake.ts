// Fake `domicile-app-host` processes, for the tests of an app's client: a
// \`spawn\` that starts them, and controls to read what the app wrote and
// answer it.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import type {
  Exit,
  Subprocess,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Signal } from "@domicile-desktop/sdk/system";

import { HOST } from "./client";
import { encodeFrame, frameDecoder } from "./frames";

/** A started host process, as a test drives it. */
export type FakeProcess = {
  /** Each message the app wrote to its stdin. */
  sent: unknown[];
  /** Writes `message` to its stdout, as one frame or split in two. */
  answer: (message: unknown, split?: number) => void;
  /** Ends it, after writing `stderr`. */
  end: (exit: Result<Exit, SystemError>, stderr?: string) => void;
  /** Each signal the app sent it. */
  killed: Signal[];
};

/**
 * A `spawn` that starts fake processes, or fails with each of `failures`
 * first.
 */
export const fakeDesktop = (failures: SystemError[] = []) => {
  const processes: FakeProcess[] = [];
  const system: Pick<Processes, "spawn"> = {
    spawn: (argv, options) => {
      if (JSON.stringify(argv) !== JSON.stringify(HOST) || !options?.stdin) {
        throw new Error(`Spawned ${argv.join(" ")}, not the app host`);
      }
      const failure = failures.shift();
      return Promise.resolve(
        failure === undefined ? Ok(fakeProcess(processes)) : Err(failure),
      );
    },
  };
  return { processes, system };
};

/** A process whose controls go in `processes`. */
const fakeProcess = (processes: FakeProcess[]): Subprocess => {
  const stdout = pushed();
  const stderr = pushed();
  const { promise: exited, resolve: settle } =
    Promise.withResolvers<Result<Exit, SystemError>>();
  const decode = frameDecoder();
  const sent: unknown[] = [];
  const killed: Signal[] = [];
  const end = (exit: Result<Exit, SystemError>, text = "") => {
    stderr.push(new TextEncoder().encode(text));
    stdout.close();
    stderr.close();
    settle(exit);
  };
  processes.push({
    answer: (message, split = 0) => {
      const frame = encodeFrame(message);
      stdout.push(frame.slice(0, split));
      stdout.push(frame.slice(split));
    },
    end,
    killed,
    sent,
  });
  return {
    closeStdin: () => {
      throw new Error("The app never closes the host's stdin");
    },
    exited,
    kill: (signal = Signal.Term) => {
      killed.push(signal);
      end(Ok({ code: undefined, signal: 15 }));
    },
    stderr: stderr.stream,
    stdout: stdout.stream,
    write: (data) => {
      sent.push(
        ...decode(
          typeof data === "string" ? new TextEncoder().encode(data) : data,
        ),
      );
    },
  };
};

/** A stream the test writes to. */
const pushed = () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start: (started) => {
      controller = started;
    },
  });
  return {
    close: () => {
      controller?.close();
    },
    push: (chunk: Uint8Array) => {
      controller?.enqueue(chunk);
    },
    stream,
  };
};

/** Lets the host spawn and write what it was asked. */
export const settled = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * The host `spawn` makes over fake processes, with what `ask` already asked
 * of it.
 */
export const started = async <Host, T>(
  spawn: (processes: Pick<Processes, "spawn">) => Host,
  ask: (host: Host) => T,
) => {
  const fake = fakeDesktop();
  const host = spawn(fake.system);
  const asked = ask(host);
  await settled();
  return { ...fake, asked, host };
};
