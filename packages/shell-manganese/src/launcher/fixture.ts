// A desktop for tests that answers the system calls opening a file makes on a
// `FakeDomicileHost`, as the compositor would: a home of `/home/me` with no
// applications, MIME globs or `mimeapps.list`.

import type { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { z } from "zod";

/** What `env -0` prints. */
const ENVIRONMENT = "HOME=/home/me\0";

/**
 * Answers the opening's system calls `fake` has made past the first
 * `answered`, and those that follow, until the shell asks nothing more.
 */
export const answerOpening = async (
  fake: FakeDomicileHost,
  answered = 0,
): Promise<void> => {
  const calls = fake.calls.filter(([method]) => method === "callSystem");
  if (calls.length > answered) {
    for (const [, id, request] of calls.slice(answered)) {
      answer(fake, z.number().parse(id), z.string().parse(request));
    }
    await new Promise((settled) => setTimeout(settled, 0));
    await answerOpening(fake, calls.length);
  }
};

/** Answers one request. Calls other features make stay unanswered. */
const answer = (fake: FakeDomicileHost, id: number, request: string): void => {
  const parsed = requestSchema.safeParse(JSON.parse(request));
  if (parsed.success) {
    answerOne(fake, id, parsed.data);
  }
};

const answerOne = (
  fake: FakeDomicileHost,
  id: number,
  asked: z.infer<typeof requestSchema>,
): void => {
  const say = (message: object) => {
    fake.dispatch("system", { data: JSON.stringify({ id, ...message }) });
  };
  switch (asked.call) {
    case "spawn": {
      say({ reply: { kind: "started" }, type: "system_reply" });
      say({
        event: {
          data: btoa(ENVIRONMENT),
          kind: "output",
          stream: "stdout",
        },
        type: "system_event",
      });
      say({
        end: { code: 0, kind: "exited", signal: null },
        type: "system_end",
      });
      break;
    }
    case "stat": {
      say({
        reply: { file_type: "file", kind: "stat", modified_ms: null, size: 0 },
        type: "system_reply",
      });
      break;
    }
    case "read_dir":
    case "read_file": {
      say({
        reply: {
          error: { kind: "not_found", message: asked.path },
          kind: "failed",
        },
        type: "system_reply",
      });
      break;
    }
  }
};

const requestSchema = z.discriminatedUnion("call", [
  z.looseObject({
    argv: z.tuple([z.literal("env"), z.literal("-0")]),
    call: z.literal("spawn"),
  }),
  z.looseObject({ call: z.literal("stat"), path: z.string() }),
  z.looseObject({ call: z.literal("read_dir"), path: z.string() }),
  z.looseObject({ call: z.literal("read_file"), path: z.string() }),
]);
