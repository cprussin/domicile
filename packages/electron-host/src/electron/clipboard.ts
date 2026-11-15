// The stand-in for Electron's `clipboard`: the desktop's clipboard through
// `wl-paste` and `wl-copy`, which Domicile's compositor serves with its
// data-control protocols, so they work with no window focused
// (docs/use/CLIPBOARD.md). Electron's clipboard is synchronous, so each call
// waits on its command.
//
// `wl-copy` offers one type per copy, so a `write` of more than one format
// throws, naming the formats, rather than dropping some.

import type { NativeImage } from "./native-image";
import { nativeImage } from "./native-image";

/** A command's exit code and output. */
export type Ran = {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
};

/** How to run a command: what goes on its stdin, and whether to keep its stdout. */
export type RunOptions = {
  readonly input?: Uint8Array | undefined;
  /** False for `wl-copy`, which leaves a child serving the copy. */
  readonly output: boolean;
};

export type ClipboardDependencies = {
  /** Runs `command` and waits for it. */
  readonly run: (command: readonly string[], options: RunOptions) => Ran;
};

/** Electron's clipboard or, on Linux, the primary selection. */
export type ClipboardType = "clipboard" | "selection";

const TEXT = "text/plain;charset=utf-8";
/** `wl-paste`'s word for any text type the copy offers. */
const ANY_TEXT = "text";
const HTML = "text/html";
const RTF = "text/rtf";
const PNG = "image/png";

/** What `wl-paste` says when there's nothing to paste of a type. */
const NOTHING =
  /Nothing is copied|No selection|No suitable type of content copied/;

export type ClipboardData = {
  text?: string | undefined;
  html?: string | undefined;
  image?: NativeImage | undefined;
  rtf?: string | undefined;
  bookmark?: string | undefined;
};

/** Builds Electron's `clipboard`. */
export const createClipboard = ({ run }: ClipboardDependencies) => {
  const primary = (type: ClipboardType | undefined) =>
    type === "selection" ? ["--primary"] : [];

  /** The command's stdout, or none when there's nothing of the type. */
  const paste = (args: readonly string[], type: ClipboardType | undefined) => {
    const ran = run(["wl-paste", ...primary(type), ...args], { output: true });
    if (ran.code === 0) {
      return ran.stdout;
    } else if (NOTHING.test(ran.stderr)) {
      return undefined;
    } else {
      throw new Error(
        `wl-paste failed, so the clipboard can't be read: ${ran.stderr.trim()}`,
      );
    }
  };

  const copy = (
    args: readonly string[],
    type: ClipboardType | undefined,
    input?: Uint8Array,
  ) => {
    const ran = run(["wl-copy", ...primary(type), ...args], {
      input,
      output: false,
    });
    if (ran.code !== 0) {
      throw new Error(
        `wl-copy failed, so the clipboard can't be written: ${ran.stderr.trim()}`,
      );
    }
  };

  const readType = (mime: string, type?: ClipboardType) =>
    paste(["--no-newline", "--type", mime], type)?.toString("utf8") ?? "";

  const writeType = (mime: string, data: Uint8Array, type?: ClipboardType) => {
    copy(["--type", mime], type, data);
  };

  const availableFormats = (type?: ClipboardType) =>
    (paste(["--list-types"], type)?.toString("utf8") ?? "")
      .split("\n")
      .filter((line) => line !== "");

  const writeText = (text: string, type?: ClipboardType) => {
    writeType(TEXT, Buffer.from(text), type);
  };

  return {
    availableFormats,

    clear: (type?: ClipboardType) => {
      copy(["--clear"], type);
    },

    has: (format: string, type?: ClipboardType) =>
      availableFormats(type).includes(format),

    read: (format: string) => readType(format),

    readBookmark: () => ({ title: "", url: "" }),

    readBuffer: (format: string) =>
      paste(["--type", format], undefined) ?? Buffer.alloc(0),

    /** A macOS pasteboard. */
    readFindText: () => "",

    readHTML: (type?: ClipboardType) => readType(HTML, type),

    readImage: (type?: ClipboardType) => {
      const png = paste(["--type", PNG], type);
      return png === undefined || png.length === 0
        ? nativeImage.createEmpty()
        : nativeImage.createFromBuffer(png);
    },

    readRTF: (type?: ClipboardType) => readType(RTF, type),

    readText: (type?: ClipboardType) => readType(ANY_TEXT, type),

    write: (data: ClipboardData, type?: ClipboardType) => {
      const formats = Object.entries(data).filter(
        ([, value]) => value !== undefined,
      );
      if (formats.length > 1) {
        throw new Error(
          `clipboard.write can't offer ${formats.map(([format]) => format).join(" and ")} at once on Domicile yet: wl-copy offers one type per copy`,
        );
      }
      const { bookmark, html, image, rtf, text } = data;
      if (text !== undefined) {
        writeText(text, type);
      } else if (html !== undefined) {
        writeType(HTML, Buffer.from(html), type);
      } else if (image !== undefined) {
        writeType(PNG, image.toPNG(), type);
      } else if (rtf !== undefined) {
        writeType(RTF, Buffer.from(rtf), type);
      } else if (bookmark !== undefined) {
        writeText(bookmark, type);
      }
    },

    writeBookmark: (_title: string, url: string, type?: ClipboardType) => {
      writeText(url, type);
    },

    writeBuffer: (format: string, buffer: Uint8Array) => {
      writeType(format, buffer);
    },

    /** A macOS pasteboard. */
    writeFindText: (_text: string) => undefined,

    writeHTML: (markup: string, type?: ClipboardType) => {
      writeType(HTML, Buffer.from(markup), type);
    },

    writeImage: (image: NativeImage, type?: ClipboardType) => {
      writeType(PNG, image.toPNG(), type);
    },

    writeRTF: (text: string, type?: ClipboardType) => {
      writeType(RTF, Buffer.from(text), type);
    },

    writeText,
  };
};
