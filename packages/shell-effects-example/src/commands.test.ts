import { describe, expect, test } from "bun:test";

import { Ok } from "@cprussin/option-result";

import { keybindings, parseCommand } from "./commands";

describe("parseCommand", () => {
  test("turns to a workspace by its number", () => {
    expect(parseCommand(["workspace", "3"], 4)).toStrictEqual(
      Ok({
        index: 2,
        kind: "workspace",
      }),
    );
  });

  test("refuses a workspace the cube has no face for", () => {
    expect(parseCommand(["workspace", "5"], 4).isErr()).toBe(true);
    expect(parseCommand(["workspace", "0"], 4).isErr()).toBe(true);
    expect(parseCommand(["workspace", "two"], 4).isErr()).toBe(true);
  });

  test("picks a close effect the shell has", () => {
    expect(parseCommand(["close-effect", "cloth"], 4)).toStrictEqual(
      Ok({
        effect: "cloth",
        kind: "close-effect",
      }),
    );
    expect(parseCommand(["close-effect", "fire"], 4).isErr()).toBe(true);
  });

  test("closes the focused window", () => {
    expect(parseCommand(["kill"], 4)).toStrictEqual(Ok({ kind: "kill" }));
    expect(parseCommand(["kill", "now"], 4).isErr()).toBe(true);
  });

  test("refuses what it does not run", () => {
    expect(parseCommand(["overview"], 4).isErr()).toBe(true);
    expect(parseCommand([], 4).isErr()).toBe(true);
  });
});

test("each workspace has its key", () => {
  expect(Object.keys(keybindings(4).keybindings ?? {}).sort()).toEqual([
    "Meta+1",
    "Meta+2",
    "Meta+3",
    "Meta+4",
    "Meta+Return",
    "Meta+Shift+q",
  ]);
});
