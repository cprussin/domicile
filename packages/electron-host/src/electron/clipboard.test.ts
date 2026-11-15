import { describe, expect, it } from "bun:test";

import { encodePng } from "../png";
import type { Ran, RunOptions } from "./clipboard";
import { createClipboard } from "./clipboard";
import { nativeImage } from "./native-image";

const PNG = Buffer.from(
  encodePng({ height: 1, rgba: new Uint8Array([1, 2, 3, 4]), width: 1 }),
);

/** A desktop clipboard holding `held` (type → bytes), as wl-paste reads it. */
const setUp = (held: Record<string, Buffer> = {}) => {
  const ran: { command: readonly string[]; options: RunOptions }[] = [];
  const clipboard = createClipboard({
    run: (command, options): Ran => {
      ran.push({ command, options });
      if (command[0] === "wl-copy") {
        return { code: 0, stderr: "", stdout: Buffer.alloc(0) };
      }
      if (command.includes("--list-types")) {
        const types = Object.keys(held);
        return types.length === 0
          ? { code: 1, stderr: "Nothing is copied\n", stdout: Buffer.alloc(0) }
          : {
              code: 0,
              stderr: "",
              stdout: Buffer.from(`${types.join("\n")}\n`),
            };
      }
      const wanted = command[command.indexOf("--type") + 1] ?? "";
      const found = Object.entries(held).find(([type]) =>
        wanted === "text" ? type.startsWith("text/plain") : type === wanted,
      );
      return found === undefined
        ? {
            code: 1,
            stderr: "No suitable type of content copied\n",
            stdout: Buffer.alloc(0),
          }
        : { code: 0, stderr: "", stdout: found[1] };
    },
  });
  return { clipboard, ran };
};

describe("reading", () => {
  it("reads text, HTML and images, as Electron's types", () => {
    const { clipboard } = setUp({
      "image/png": PNG,
      "text/html": Buffer.from("<b>hi</b>"),
      "text/plain": Buffer.from("hi"),
    });

    expect(clipboard.readText()).toBe("hi");
    expect(clipboard.readHTML()).toBe("<b>hi</b>");
    expect(clipboard.readImage().getSize()).toEqual({ height: 1, width: 1 });
    expect(clipboard.availableFormats()).toEqual([
      "image/png",
      "text/html",
      "text/plain",
    ]);
    expect(clipboard.has("text/html")).toBe(true);
    expect(clipboard.readBuffer("text/html").toString()).toBe("<b>hi</b>");
  });

  it("reads nothing from an empty clipboard, as Electron does", () => {
    const { clipboard } = setUp();

    expect(clipboard.readText()).toBe("");
    expect(clipboard.readImage().isEmpty()).toBe(true);
    expect(clipboard.availableFormats()).toEqual([]);
  });

  it("reads the primary selection when asked", () => {
    const { clipboard, ran } = setUp({ "text/plain": Buffer.from("hi") });

    clipboard.readText("selection");

    expect(ran[0]?.command).toEqual([
      "wl-paste",
      "--primary",
      "--no-newline",
      "--type",
      "text",
    ]);
  });

  it("says why when wl-paste fails", () => {
    const clipboard = createClipboard({
      run: () => ({
        code: 1,
        stderr: "Failed to connect to a Wayland server\n",
        stdout: Buffer.alloc(0),
      }),
    });

    expect(() => clipboard.readText()).toThrow(
      "wl-paste failed, so the clipboard can't be read: Failed to connect",
    );
  });
});

describe("writing", () => {
  it("copies each format with its type, keeping no output", () => {
    const { clipboard, ran } = setUp();

    clipboard.writeText("hi");
    clipboard.writeHTML("<b>hi</b>", "selection");
    clipboard.writeImage(nativeImage.createFromBuffer(PNG));
    clipboard.clear();

    expect(ran.map(({ command }) => command)).toEqual([
      ["wl-copy", "--type", "text/plain;charset=utf-8"],
      ["wl-copy", "--primary", "--type", "text/html"],
      ["wl-copy", "--type", "image/png"],
      ["wl-copy", "--clear"],
    ]);
    expect(ran[0]?.options).toEqual({
      input: Buffer.from("hi"),
      output: false,
    });
    expect(Buffer.compare(Buffer.from(ran[2]?.options.input ?? []), PNG)).toBe(
      0,
    );
  });

  it("writes one format, and refuses several rather than dropping some", () => {
    const { clipboard, ran } = setUp();

    clipboard.write({ text: "hi" });
    expect(ran[0]?.command).toEqual([
      "wl-copy",
      "--type",
      "text/plain;charset=utf-8",
    ]);
    expect(() => clipboard.write({ html: "<b>hi</b>", text: "hi" })).toThrow(
      "can't offer html and text at once",
    );
  });

  it("says why when wl-copy fails", () => {
    const clipboard = createClipboard({
      run: () => ({
        code: 1,
        stderr: "wl-copy: not found\n",
        stdout: Buffer.alloc(0),
      }),
    });

    expect(() => clipboard.writeText("hi")).toThrow(
      "wl-copy failed, so the clipboard can't be written: wl-copy: not found",
    );
  });
});
