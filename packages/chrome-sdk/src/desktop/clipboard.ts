// The clipboard's history, which the compositor keeps.

import type { DomicileClipboardEntry, DomicileHost } from "../domicile-host";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/**
 * One copy: an id, whether it is an image, enough of it to recognize, and for
 * an image, a small picture of it as a `data:` URL.
 */
export type ClipboardEntry = {
  readonly id: number;
  readonly image: boolean;
  readonly preview: string;
  readonly thumbnail: string | undefined;
};

export type ClipboardListeners = {
  change: () => void;
};

export type Clipboard = {
  /** Newest first; `undefined` until the compositor says. */
  readonly entries: readonly ClipboardEntry[] | undefined;
  /** Put entry `id` back on the clipboard. An id since dropped sets nothing. */
  copy: (id: number) => void;
  on: On<ClipboardListeners>;
};

export type ClipboardHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "clipboard"
  | "copyClipboardEntry"
  | "removeEventListener"
>;

export const clipboard = (host: ClipboardHost): Clipboard => {
  const entriesOf = memoizeLast(
    (list: readonly DomicileClipboardEntry[] | null) => list?.map(entryOf),
  );
  return {
    copy: (id) => {
      host.copyClipboardEntry(id);
    },
    get entries() {
      return entriesOf(host.clipboard);
    },
    on: on<ClipboardListeners>({
      change: (listener) =>
        hostEvent(host, "clipboardchanged", () => listener()),
    }),
  };
};

/** The engine sends `""` for a row with no thumbnail. */
const entryOf = (entry: DomicileClipboardEntry): ClipboardEntry => ({
  id: entry.id,
  image: entry.image,
  preview: entry.preview,
  thumbnail: entry.thumbnail === "" ? undefined : entry.thumbnail,
});
