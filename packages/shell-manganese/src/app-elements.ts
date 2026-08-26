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

  /**
   * The size each client is last known to have drawn at, by app id.
   *
   * Kept because the two halves do not arrive together: the first size comes
   * on `app_appeared`, and the element that needs it is mounted a render
   * later, so whichever is second is the one that joins them. Kept *current*
   * because the record outlives any one element — a portal is remounted
   * whenever the shell stops rendering that window and starts again — and a
   * client that resized in between would be handed a size it has left behind,
   * with nothing coming to correct it where the compositor draws the client
   * itself.
   *
   * A copied frame is not recorded here. It is the same fact, but a remounted
   * portal on the copy path is re-supplied by the hand-over the compositor
   * does for it, so the element is told again; and the sizes a frame carries
   * are physical rather than logical, which only `drawFrame` converts.
   */
  readonly #drawnAlready = new Map<string, readonly [number, number]>();
  readonly #now: typeof monotonicNow;

  constructor(now: typeof monotonicNow = monotonicNow) {
    this.#now = now;
  }

  register(appId: string, element: DomicileAppElement): void {
    this.#elements.set(appId, element);
    const size = this.#drawnAlready.get(appId);
    if (size !== undefined) {
      element.setSurfaceSize(size[0], size[1]);
    }
  }

  unregister(appId: string): void {
    this.#elements.delete(appId);
  }

  /**
   * The client is gone, so forget that it had drawn.
   *
   * Housekeeping rather than correctness: app ids are handed out from a
   * counter that only ever goes up, so a record left behind is one nothing
   * will ever ask for again. It is still a record per window the session has
   * ever opened, which is what this is for.
   *
   * Keyed to the client going rather than to the element unmounting, because
   * those are not the same event. A portal is unmounted whenever the shell
   * stops rendering it — while the display list is empty, say — and the client
   * behind it is still running and still drawn; dropping the record there
   * would put the placeholder back over it when the window returns.
   */
  closed(appId: string): void {
    this.#drawnAlready.delete(appId);
  }

  /**
   * Note that a client already has a surface, from the size its announcement
   * carried.
   *
   * A size on `app_appeared` means the client has committed at least once,
   * which is what separates the replay a reloading chrome is given from a
   * window that has only just mapped. The element has to be told, because
   * nothing else will: where the compositor draws the client itself the
   * hand-over sends no frame, and `app_resized` answers only a size that
   * *changed*, so an idle client sends neither. Left untold, the element
   * paints its "app surface" placeholder over a live window until the user
   * happens to resize it.
   *
   * No size is the ordinary case — a window that has just mapped — and there
   * is nothing to note about it. Worth a branch rather than a caller's
   * business because the replay goes out to every chrome whenever any chrome
   * shakes hands, so an announcement carrying no size can perfectly well find
   * an element already mounted for it.
   */
  announced(appId: string, size: readonly [number, number] | undefined): void {
    if (size !== undefined) {
      this.#drawnAlready.set(appId, size);
      this.#elements.get(appId)?.setSurfaceSize(size[0], size[1]);
    }
  }

  // A frame for an app with no element is a no-op: the host may still be
  // draining frames for a portal this chrome has already torn down.
  drawFrame({
    app_id,
    width,
    height,
    scale,
    pixels,
    region,
  }: Pick<
    AppFrameMessage,
    "app_id" | "width" | "height" | "scale" | "pixels" | "region"
  >): void {
    const element = this.#elements.get(app_id);
    // Only a draw that happened is priced: recording a zero for a frame that
    // hit no element would pull the average down with work never done.
    if (element !== undefined) {
      const started = this.#now();
      element.drawFrame(width, height, scale, pixels, region);
      this.drawTiming.record(this.#now() - started);
    }
  }

  // The client redrew at a new resolution; the element needs it to scale
  // pointer coordinates even before the first frame at that size arrives.
  // Recorded as well as applied, so that the element mounted after the next
  // remount is told this size rather than the announcement's.
  resize({ app_id, size }: Pick<AppResizedMessage, "app_id" | "size">): void {
    this.#drawnAlready.set(app_id, size);
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
