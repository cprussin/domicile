// biome-ignore-all lint/suspicious/noConsole: this harness's whole output is what it reports

// Reports whether the frames reaching a chrome carry *straight* alpha.
//
// Driven by scripts/e2e-window-alpha.sh. A Wayland client commits
// premultiplied alpha; the page draws what arrives with `putImageData`, which
// is defined as straight alpha and multiplies by alpha again. So the
// compositor divides it back out, and this is what says it did.
//
// The client paints one flat colour at one alpha, so every translucent pixel
// in the frame should carry the same red. Reported as a range rather than a
// single reading: a compositor that converted some pixels and not others would
// look identical to one that converted all of them if only one were sampled.

import net from "node:net";

import { helloMessage } from "@domicile/chrome-sdk/chrome-message";
import { createHostStreamReader } from "@domicile/chrome-sdk/host-stream";
import { withFrameDelimiter } from "@domicile/chrome-sdk/newline-frames";
import { parseHostMessage } from "@domicile/chrome-sdk/protocol";

import { listenWindowMs, requireSocketPath } from "./chrome-socket";

const BYTES_PER_PIXEL = 4;
const RED = 0;
const ALPHA = 3;

/**
 * How far from half alpha a pixel may be and still count.
 *
 * The client asks for exactly 0.5, but an engine rounds and may blend against
 * its own backdrop at the edges, so the band is what separates the flat
 * interior from the anti-aliased border.
 */
const HALF = 128;
const TOLERANCE = 8;

/** The red channel across the pixels that are about half transparent. */
type RedReport = {
  matched: number;
  minRed: number;
  maxRed: number;
};

const redAtHalfAlpha = (pixels: Uint8Array): RedReport => {
  let minRed = 255;
  let maxRed = 0;
  let matched = 0;
  for (
    let at = 0;
    at + BYTES_PER_PIXEL <= pixels.length;
    at += BYTES_PER_PIXEL
  ) {
    // Indexing past the end is `undefined` rather than a throw, so a truncated
    // frame would otherwise read as a run of black pixels.
    const alpha = pixels[at + ALPHA] ?? 0;
    if (Math.abs(alpha - HALF) > TOLERANCE) {
      continue;
    }
    const red = pixels[at + RED] ?? 0;
    minRed = Math.min(minRed, red);
    maxRed = Math.max(maxRed, red);
    matched += 1;
  }
  return { matched, maxRed, minRed };
};

const socket = new net.Socket();
const readHost = createHostStreamReader();
// The *latest* frame. A window maps and commits before its page has painted,
// so the first frame is reliably empty.
let latest: (RedReport & { appId: string; size: string }) | undefined;
let frames = 0;

socket.on("error", () => undefined);

socket.on("data", (chunk: Buffer) => {
  for (const item of readHost(chunk)) {
    const message = parseHostMessage(item.text);
    if (message?.type === "app_frame" && item.pixels !== undefined) {
      frames += 1;
      const report = redAtHalfAlpha(item.pixels);
      // Frames with nothing translucent in them are the ones committed before
      // the page painted; keeping the last of those would report the window as
      // having no half-alpha pixels at all.
      if (report.matched > 0) {
        latest = {
          ...report,
          appId: message.app_id,
          size: `${message.width.toString()}x${message.height.toString()}`,
        };
      }
    }
  }
});

socket.connect(requireSocketPath(Bun.env), () => {
  socket.write(withFrameDelimiter(JSON.stringify(helloMessage())));
});

setTimeout(() => {
  if (latest === undefined) {
    console.log("red: no frame with half-transparent pixels arrived");
  } else {
    console.log(
      `red app_id=${latest.appId} ${latest.size} frames=${frames.toString()} ` +
        `matched=${latest.matched.toString()} min=${latest.minRed.toString()} ` +
        `max=${latest.maxRed.toString()}`,
    );
  }
  socket.destroy();
  process.exit(0);
}, listenWindowMs(Bun.env));
