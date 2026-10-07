// An Ogg Vorbis or Opus file's comment: the second packet of its first
// stream. https://xiph.org/ogg/doc/framing.html

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";

import type { AudioTags } from "../file-preview";
import type { SystemError } from "../system";
import { holds, u32le } from "./bytes";
import type { ParsedTags } from "./parsed-tags";
import { audioTagsOf, NOTHING_SAID } from "./parsed-tags";
import { COVER_BYTES } from "./picture";
import type { ReadBytes } from "./read-bytes";
import { vorbisComment } from "./vorbis-comment";

/** A page's header before its segment table. */
const PAGE_HEADER_BYTES = 27;

/** Most segments a page has. */
const SEGMENTS = 255;

/** Largest comment read: a cover that is sent, in base64, and the rest. */
const COMMENT_BYTES = 2 * COVER_BYTES + 64 * 1024;

/** The comment packet's start, by codec, before the comment itself. */
const COMMENT_HEADERS = ["\u0003vorbis", "OpusTags"];

/** The packets read so far, and the bytes of one still running on. */
type Packets = { whole: Uint8Array[]; running: Uint8Array[] };

export const oggTags = async (
  read: ReadBytes,
): Promise<Result<AudioTags, SystemError>> =>
  (await packetsFrom(read, 0, undefined, { running: [], whole: [] })).map(
    (packets) => audioTagsOf(commentIn(packets)),
  );

/**
 * The first two packets of stream `serial`, the first stream's when
 * `undefined`, reading pages from `at`. Fewer when the file, or the size this
 * reads, ends first.
 */
const packetsFrom = async (
  read: ReadBytes,
  at: number,
  serial: number | undefined,
  packets: Packets,
): Promise<Result<Uint8Array[], SystemError>> =>
  packets.whole.length >= 2 || runningBytes(packets) > COMMENT_BYTES
    ? Ok(packets.whole)
    : (await read(at, PAGE_HEADER_BYTES + SEGMENTS)).andThenAsync((head) => {
        const page = pageAt(at, head);
        return page === undefined
          ? Promise.resolve(Ok(packets.whole))
          : nextPage(read, page, serial ?? page.serial, packets);
      });

/** A page's stream, its lacing values and where its body lies. */
type Page = {
  serial: number;
  lacing: Uint8Array;
  bodyAt: number;
  bodyBytes: number;
};

/** The page whose header, `head`, is at `at`, if it is one and whole. */
const pageAt = (at: number, head: Uint8Array): Page | undefined => {
  const segments = head[PAGE_HEADER_BYTES - 1];
  const lacing =
    segments === undefined
      ? undefined
      : head.subarray(PAGE_HEADER_BYTES, PAGE_HEADER_BYTES + segments);
  return segments === undefined ||
    lacing === undefined ||
    lacing.length < segments ||
    !holds(head, "OggS")
    ? undefined
    : {
        bodyAt: at + PAGE_HEADER_BYTES + segments,
        bodyBytes: lacing.reduce((sum, lace) => sum + lace, 0),
        lacing,
        serial: u32le(head, 14),
      };
};

/** `packets` with `page`'s if it is of stream `serial`, then the pages after. */
const nextPage = async (
  read: ReadBytes,
  page: Page,
  serial: number,
  packets: Packets,
): Promise<Result<Uint8Array[], SystemError>> => {
  const after = page.bodyAt + page.bodyBytes;
  return page.serial === serial
    ? (await read(page.bodyAt, page.bodyBytes)).andThenAsync((body) =>
        packetsFrom(read, after, serial, laced(packets, page.lacing, body)),
      )
    : packetsFrom(read, after, serial, packets);
};

/** `packets` with a page's segments added. A lace under 255 ends a packet. */
const laced = (
  packets: Packets,
  lacing: Uint8Array,
  body: Uint8Array,
): Packets => {
  const whole = [...packets.whole];
  let running = [...packets.running];
  let at = 0;
  for (const lace of lacing) {
    running.push(body.subarray(at, at + lace));
    at += lace;
    if (lace < SEGMENTS) {
      whole.push(joined(running));
      running = [];
    }
  }
  return { running, whole };
};

const runningBytes = ({ running }: Packets): number =>
  running.reduce((sum, part) => sum + part.length, 0);

const joined = (parts: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  parts.reduce((at, part) => {
    bytes.set(part, at);
    return at + part.length;
  }, 0);
  return bytes;
};

/** The comment in the second packet, for a codec this reads. */
const commentIn = (packets: readonly Uint8Array[]): ParsedTags => {
  const packet = packets[1];
  const header =
    packet === undefined
      ? undefined
      : COMMENT_HEADERS.find((start) => holds(packet, start));
  return packet === undefined || header === undefined
    ? NOTHING_SAID
    : vorbisComment(packet.subarray(header.length));
};
