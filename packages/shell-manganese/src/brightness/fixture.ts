// A machine for tests that answers the shell's system calls on a
// `FakeDomicileHost` from fixed files, as the compositor would.

import type { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { z } from "zod";

/** A ThinkPad's `/sys/class/backlight`, recorded, at 9 of 15. */
export const THINKPAD_BACKLIGHT: Readonly<Record<string, string>> = {
  "/sys/class/backlight/acpi_video0/brightness": "9\n",
  "/sys/class/backlight/acpi_video0/max_brightness": "15\n",
  "/sys/class/backlight/acpi_video0/type": "firmware\n",
};

/**
 * Answers the backlight's system calls `fake` makes, and those that follow,
 * until the shell asks nothing more. `files` maps a path to its contents; a
 * directory lists the files under it. Processes start and print nothing, and
 * logind's `SetBrightness` returns nothing. Other calls, such as the
 * battery's, stay unanswered.
 */
export const answerSystemCalls = async (
  fake: FakeDomicileHost,
  files: Readonly<Record<string, string>>,
  answered = 0,
): Promise<void> => {
  const calls = fake.calls.filter(([method]) => method === "callSystem");
  if (calls.length > answered) {
    for (const [, id, request] of calls.slice(answered)) {
      answer(fake, files, z.number().parse(id), z.string().parse(request));
    }
    await new Promise((settled) => setTimeout(settled, 0));
    await answerSystemCalls(fake, files, calls.length);
  }
};

const answer = (
  fake: FakeDomicileHost,
  files: Readonly<Record<string, string>>,
  id: number,
  request: string,
): void => {
  const parsed = requestSchema.safeParse(JSON.parse(request));
  if (parsed.success) {
    answerOne(fake, files, id, parsed.data);
  }
};

const answerOne = (
  fake: FakeDomicileHost,
  files: Readonly<Record<string, string>>,
  id: number,
  asked: z.infer<typeof requestSchema>,
): void => {
  const say = (message: object) => {
    fake.dispatch("system", { data: JSON.stringify({ id, ...message }) });
  };
  switch (asked.call) {
    case "read_dir": {
      say({
        reply: {
          entries: Object.keys(files)
            .filter((path) => path.startsWith(`${asked.path}/`))
            .map((path) => path.slice(asked.path.length + 1).split("/")[0])
            .filter((name, index, names) => names.indexOf(name) === index)
            .map((name) => ({ file_type: "symlink", name })),
          kind: "entries",
        },
        type: "system_reply",
      });
      break;
    }
    case "read_file": {
      const contents = files[asked.path];
      say({
        reply:
          contents === undefined
            ? {
                error: { kind: "not_found", message: asked.path },
                kind: "failed",
              }
            : { data: btoa(contents), kind: "read" },
        type: "system_reply",
      });
      break;
    }
    case "spawn": {
      say({ reply: { kind: "started" }, type: "system_reply" });
      break;
    }
    case "kill": {
      say({
        end: { code: null, kind: "exited", signal: 15 },
        type: "system_end",
      });
      break;
    }
    case "dbus_call": {
      say({
        reply: { body: "[]", kind: "returned", signature: "" },
        type: "system_reply",
      });
      break;
    }
  }
};

const UNDER_BACKLIGHT = /^\/sys\/class\/backlight(\/|$)/;

const requestSchema = z.discriminatedUnion("call", [
  z.object({
    call: z.literal("read_dir"),
    path: z.string().regex(UNDER_BACKLIGHT),
  }),
  z.object({
    call: z.literal("read_file"),
    path: z.string().regex(UNDER_BACKLIGHT),
  }),
  z
    .object({
      argv: z.tuple([z.literal("udevadm")]).rest(z.string()),
      call: z.literal("spawn"),
    })
    .loose(),
  z.object({ call: z.literal("kill") }).loose(),
  z
    .object({
      call: z.literal("dbus_call"),
      member: z.literal("SetBrightness"),
    })
    .loose(),
]);
