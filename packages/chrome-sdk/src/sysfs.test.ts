import { describe, expect, it } from "bun:test";
import { Err, None, Ok, Some } from "@cprussin/option-result";

import type { SysfsDesktop } from "./sysfs";
import { anyOf, sysfsEntries, sysfsLine } from "./sysfs";
import type { SystemError } from "./system";
import { FileType, SystemErrorKind } from "./system";

const NOT_FOUND: SystemError = {
  kind: SystemErrorKind.NotFound,
  message: "No such file or directory",
};

const DENIED: SystemError = {
  kind: SystemErrorKind.PermissionDenied,
  message: "Permission denied",
};

/** A desktop whose every read answers `answer`. */
const answering = (
  answer: { dir: string[] } | { text: string } | { error: SystemError },
): SysfsDesktop => ({
  files: {
    readDir: () =>
      Promise.resolve(
        "error" in answer
          ? Err(answer.error)
          : Ok(
              ("dir" in answer ? answer.dir : []).map((name) => ({
                fileType: FileType.Symlink,
                name,
              })),
            ),
      ),
    readText: () =>
      Promise.resolve(
        "error" in answer
          ? Err(answer.error)
          : Ok("text" in answer ? answer.text : ""),
      ),
  },
});

describe(sysfsEntries, () => {
  it("lists a directory's names", async () => {
    expect(
      await sysfsEntries(answering({ dir: ["BAT0", "AC"] }), "/sys/x"),
    ).toEqual(Ok(["BAT0", "AC"]));
  });

  it("lists none when the directory does not exist", async () => {
    expect(
      await sysfsEntries(answering({ error: NOT_FOUND }), "/sys/x"),
    ).toEqual(Ok([]));
  });

  it("fails when the directory cannot be read", async () => {
    expect(await sysfsEntries(answering({ error: DENIED }), "/sys/x")).toEqual(
      Err(DENIED),
    );
  });
});

describe(sysfsLine, () => {
  it("reads a line without its newline", async () => {
    expect(await sysfsLine(answering({ text: "Battery\n" }), "/sys/x")).toEqual(
      Ok(Some("Battery")),
    );
  });

  it("reads none when the file does not exist", async () => {
    expect(await sysfsLine(answering({ error: NOT_FOUND }), "/sys/x")).toEqual(
      Ok(None()),
    );
  });

  it("fails when the file cannot be read", async () => {
    expect(await sysfsLine(answering({ error: DENIED }), "/sys/x")).toEqual(
      Err(DENIED),
    );
  });
});

describe(anyOf, () => {
  it("stops at the first name that holds", async () => {
    const tried: string[] = [];
    expect(
      await anyOf(["a", "b", "c"], (name) => {
        tried.push(name);
        return Promise.resolve(Ok(name === "b"));
      }),
    ).toEqual(Ok(true));
    expect(tried).toEqual(["a", "b"]);
  });

  it("holds for none of no names", async () => {
    expect(await anyOf([], () => Promise.resolve(Ok(true)))).toEqual(Ok(false));
  });

  it("stops at the first error", async () => {
    expect(
      await anyOf(["a", "b"], (name) =>
        Promise.resolve(name === "a" ? Err(DENIED) : Ok(true)),
      ),
    ).toEqual(Err(DENIED));
  });
});
