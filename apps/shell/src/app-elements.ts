// The live `<domicile-app>` elements, by app id.
//
// React decides which portals exist — one element per window in the shell's
// state — but a client's frames arrive many times a second and carry a whole
// window of pixels, so they never go through React state. Each mounted element
// registers itself here, and the host's per-app events are applied to it
// directly.

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type {
  AppCompositedMessage,
  AppCursorMessage,
  AppFrameMessage,
  AppResizedMessage,
} from "@domicile/chrome-sdk/protocol";
import { SampleWindow } from "@domicile/chrome-sdk/sample-window";

/** The clock the draw timing reads; a parameter so tests can hold it. */
const monotonicNow = (): number => performance.now();

export class AppElements {
  /**
   * How long the canvas draw is taking — the last stage of the round trip, and
   * one of the two the compositor cannot see. Read by whoever reports.
   */
  readonly drawTiming = new SampleWindow();

  readonly #elements = new Map<string, DomicileAppElement>();
  readonly #now: typeof monotonicNow;

  constructor(now: typeof monotonicNow = monotonicNow) {
    this.#now = now;
  }

  register(appId: string, element: DomicileAppElement): void {
    this.#elements.set(appId, element);
  }

  unregister(appId: string): void {
    this.#elements.delete(appId);
  }

  // A frame for an app with no element is a no-op: the host may still be
  // draining frames for a portal this chrome has already torn down.
  drawFrame({
    app_id,
    width,
    height,
    scale,
    pixels,
  }: Pick<
    AppFrameMessage,
    "app_id" | "width" | "height" | "scale" | "pixels"
  >): void {
    const element = this.#elements.get(app_id);
    // Only a draw that happened is priced: recording a zero for a frame that
    // hit no element would pull the average down with work never done.
    if (element !== undefined) {
      const started = this.#now();
      element.drawFrame(width, height, scale, pixels);
      this.drawTiming.record(this.#now() - started);
    }
  }

  // The client redrew at a new resolution; the element needs it to scale
  // pointer coordinates even before the first frame at that size arrives.
  resize({ app_id, size }: Pick<AppResizedMessage, "app_id" | "size">): void {
    this.#elements.get(app_id)?.setSurfaceSize(size[0], size[1]);
  }

  applyCursor({
    app_id,
    cursor,
  }: Pick<AppCursorMessage, "app_id" | "cursor">): void {
    this.#elements.get(app_id)?.applyCursor(cursor);
  }

  // The compositor has taken this window back and is drawing the client's own
  // buffer. Whatever pixels this element holds are a still of the window, and
  // the chrome is composited over the client — so they would hide the live one.
  composited({ app_id }: Pick<AppCompositedMessage, "app_id">): void {
    this.#elements.get(app_id)?.dropSurface();
  }
}
