// A stand-in for the compositor's processes, for tests: `run` answers from a
// script, and `spawn` hands out processes a test feeds and ends.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  Exit,
  Ran,
  Signal,
  SpawnOptions,
  Subprocess,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { AudioSystem } from "./sound-server";

/** A spawned process a test drives. */
export type FakeProcess = {
  argv: readonly string[];
  options: SpawnOptions | undefined;
  /** Writes to its stdout. */
  print: (data: Uint8Array | string) => void;
  /** Ends it with `code`. */
  exit: (code: number) => void;
  /** The signals it was sent. */
  killed: (Signal | undefined)[];
};

/** What `run` answers for an argv: output and exit code. */
export type Answer = { stdout: string; stderr?: string; code?: number };

export class FakeSystem implements AudioSystem {
  /** Every argv run, in order, with its options. */
  readonly ran: [argv: readonly string[], options: unknown][] = [];
  readonly spawned: FakeProcess[] = [];
  /** Whether `spawn` fails, as for a missing binary. */
  spawnFails = false;
  readonly #answer: (argv: readonly string[]) => Answer;
  readonly #spawnedOne: (() => void)[] = [];

  constructor(answer: (argv: readonly string[]) => Answer) {
    this.#answer = answer;
  }

  run = (
    argv: readonly string[],
    options?: Omit<SpawnOptions, "stdin">,
  ): Promise<Result<Ran, SystemError>> => {
    this.ran.push([argv, options]);
    const { code = 0, stderr = "", stdout } = this.#answer(argv);
    return Promise.resolve(Ok({ code, signal: undefined, stderr, stdout }));
  };

  spawn = (
    argv: readonly string[],
    options?: SpawnOptions,
  ): Promise<Result<Subprocess, SystemError>> => {
    if (this.spawnFails) {
      return Promise.resolve(
        Err({ kind: SystemErrorKind.NotFound, message: `no ${argv[0]}` }),
      );
    } else {
      const { process, subprocess } = fakeProcess(argv, options);
      this.spawned.push(process);
      for (const waiting of this.#spawnedOne.splice(0)) {
        waiting();
      }
      return Promise.resolve(Ok(subprocess));
    }
  };

  /** Resolves once `count` processes have been spawned. */
  spawnedAtLeast = async (count: number): Promise<void> => {
    while (this.spawned.length < count) {
      await new Promise<void>((resolve) => {
        this.#spawnedOne.push(resolve);
      });
    }
  };
}

const fakeProcess = (
  argv: readonly string[],
  options: SpawnOptions | undefined,
) => {
  const stdout =
    Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const exited = Promise.withResolvers<Result<Exit, SystemError>>();
  const killed: (Signal | undefined)[] = [];
  const state = { over: false };
  // Once only: a process killed after it exited stays exited.
  const end = async (exit: Exit) => {
    if (!state.over) {
      state.over = true;
      (await stdout.promise).close();
      exited.resolve(Ok(exit));
    }
  };
  const process: FakeProcess = {
    argv,
    exit: (code) => {
      end({ code, signal: undefined }).catch((error: unknown) => {
        throw error;
      });
    },
    killed,
    options,
    // A process that ended prints nothing.
    print: (data) => {
      if (!state.over) {
        stdout.promise
          .then((controller) => {
            controller.enqueue(
              typeof data === "string" ? new TextEncoder().encode(data) : data,
            );
          })
          .catch((error: unknown) => {
            throw error;
          });
      }
    },
  };
  const subprocess: Subprocess = {
    closeStdin: () => undefined,
    exited: exited.promise,
    kill: (signal) => {
      killed.push(signal);
      end({ code: undefined, signal: 15 }).catch((error: unknown) => {
        throw error;
      });
    },
    stderr: new ReadableStream(),
    stdout: new ReadableStream({ start: stdout.resolve }),
    write: () => undefined,
  };
  return { process, subprocess };
};
