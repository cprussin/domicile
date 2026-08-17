// biome-ignore-all lint/suspicious/noConsole: this harness's whole output is what it reports

// Reports whether the frames an app commits carry real transparency.
//
// Driven by scripts/probe-transparency.sh. The question it answers is the one
// the whole hole-punching design rests on: when the chrome asks its engine for
// a transparent window, does the engine commit a buffer with genuine alpha, or
// does it commit black? Both look like "a window" from every other angle, and
// only the pixels tell them apart.

import net from "node:net";

import { helloMessage } from "@domicile/chrome-sdk/chrome-message";
import { createHostStreamReader } from "@domicile/chrome-sdk/host-stream";
import { withFrameDelimiter } from "@domicile/chrome-sdk/newline-frames";
import { parseHostMessage } from "@domicile/chrome-sdk/protocol";

import { listenWindowMs, requireSocketPath } from "./chrome-socket";

const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;

/** What a frame's alpha channel looks like. */
type AlphaReport = {
  pixels: number;
  minAlpha: number;
  maxAlpha: number;
  /** Pixels that are fully see-through. */
  clear: number;
};

const alphaOf = (pixels: Uint8Array): AlphaReport => {
  let minAlpha = OPAQUE;
  let maxAlpha = 0;
  let clear = 0;
  for (let at = ALPHA_OFFSET; at < pixels.length; at += BYTES_PER_PIXEL) {
    // Indexing a typed array past its end is `undefined` rather than a throw,
    // so a truncated frame would silently read as fully transparent.
    const alpha = pixels[at] ?? OPAQUE;
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (alpha === 0) {
      clear += 1;
    }
  }
  return {
    clear,
    maxAlpha,
    minAlpha,
    pixels: pixels.length / BYTES_PER_PIXEL,
  };
};

const socket = new net.Socket();
const readHost = createHostStreamReader();
// The *latest* frame, not the first. A window maps and commits before its page
// has painted anything, so the first frame is reliably empty and reading it
// would report every chrome as fully transparent.
let latest: (AlphaReport & { appId: string; size: string }) | undefined;
let frames = 0;

socket.on("error", () => undefined);

socket.on("data", (chunk: Buffer) => {
  for (const item of readHost(chunk)) {
    const message = parseHostMessage(item.text);
    if (message?.type === "app_frame" && item.pixels !== undefined) {
      frames += 1;
      latest = {
        ...alphaOf(item.pixels),
        appId: message.app_id,
        size: `${message.width.toString()}x${message.height.toString()}`,
      };
    }
  }
});

socket.connect(requireSocketPath(Bun.env), () => {
  socket.write(withFrameDelimiter(JSON.stringify(helloMessage())));
});

setTimeout(() => {
  if (latest === undefined) {
    console.log("alpha: no frame arrived");
  } else {
    console.log(
      `alpha app_id=${latest.appId} ${latest.size} frames=${frames.toString()} ` +
        `pixels=${latest.pixels.toString()} min=${latest.minAlpha.toString()} ` +
        `max=${latest.maxAlpha.toString()} clear=${latest.clear.toString()}`,
    );
  }
  socket.destroy();
  process.exit(0);
}, listenWindowMs(Bun.env));
