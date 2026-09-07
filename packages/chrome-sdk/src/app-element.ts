// The `<domicile-app>` custom element: a placeholder for a real Wayland client.
//
// On connect it measures its on-screen box and tells the host to composite the
// client there; on disconnect it tells the host to stop. The host draws the
// client's actual surface into that transformed box, so the app inherits full
// CSS — that is the whole point of Domicile.
//
// Custom element tag names must contain a hyphen, so the SDK registers
// `domicile-app`. A chrome that prefers the bare `<app>` the compositor exposes
// gets it from `aliasTag` until the engine makes the short name real.

import type { ElementContext } from "./element-context";
import { focusedApp, setFocusedApp } from "./element-context";
import { buttonCodeFromJs } from "./input";
import { placementTiming } from "./placement-timing";
import type { CursorShape } from "./protocol";
import { surfaceLocal } from "./surface-coordinates";
import { axisFromWheel } from "./wheel-axis";

/** The class name the shell stylesheet uses to hide the empty placeholder. */
const HAS_SURFACE_CLASS = "has-surface";

/**
 * What a `<domicile-app>` is, to everything holding one.
 *
 * Written out rather than derived from the class with `InstanceType` — which is
 * what this was — because the class is an anonymous expression, and TypeScript
 * will not name an anonymous class's `#private` fields in a `.d.ts`. Derived,
 * this package cannot emit types at all, and a package that cannot emit types
 * cannot be published for a shell outside this repo to build against.
 *
 * Writing it out is the better contract anyway: what a shell may call is now
 * stated rather than being whatever the class happens to leave public.
 */
export type DomicileAppElement = HTMLElement & {
  /** The host's name for the client this portal shows. */
  get appId(): string | undefined;
  set appId(value: string);
  /** Tell the host the client should be this many logical pixels. */
  setSurfaceSize(width: number, height: number): void;
  /** Put the keyboard on this client without a click. */
  focusApp(): void;
  /** Give up the canvas this element was showing a client's window in. */
  dropSurface(): void;
  applyCursor(cursor: CursorShape): void;
  /**
   * Draw a frame the host pushed. `region`, when given, is the part of the
   * surface `pixels` covers; without it they are the whole surface.
   */
};

/**
 * The `<domicile-app>` class, closed over what the SDK was bound with.
 *
 * A factory rather than a class because a custom element is constructed by the
 * DOM, which hands it nothing: the collaborators have to reach it some other
 * way, and reading them back from module scope means reading a bridge that the
 * types say might not be bound. It always is — this class does not exist until
 * `registerElements` has bound one — so closing over the context is what makes
 * the case that cannot happen also impossible to write.
 */
export const createAppElement = (
  context: ElementContext,
): (new () => DomicileAppElement) =>
  class DomicileAppElement extends HTMLElement {
    static observedAttributes = ["app-id"];

    #canvas: HTMLCanvasElement | undefined;
    #surfaceWidth = 0;
    #surfaceHeight = 0;
    #unobserve: (() => void) | undefined;
    // The last placement and render size sent, so a measurement that changed
    // nothing costs nothing. See `#place`.
    #placed: string | undefined;
    #rendered: string | undefined;

    constructor() {
      super();
      this.#installPointerForwarding();
    }

    get appId(): string | undefined {
      return this.getAttribute("app-id") ?? undefined;
    }

    set appId(value: string) {
      this.setAttribute("app-id", value);
    }

    connectedCallback(): void {
      this.#embedSurface();
      this.#place();
      // CSS moves, resizes and restyles the element without any of this code
      // running, so the portal has to follow the box rather than be reported
      // once. Everything the compositor draws this window with is read from the
      // page, so anything the page can change is something this has to see.
      this.#unobserve = context.observePlacement(() => {
        this.#place();
      });
    }

    disconnectedCallback(): void {
      this.#unobserve?.();
      this.#unobserve = undefined;
      const appId = this.appId;
      if (appId !== undefined) {
        context.bridge.removePortal(appId);
        // The host no longer knows where this window is, so the next placement
        // has to be sent however little the element moved in the meantime. Not
        // the render size: `remove_portal` takes the portal out of the scene and
        // leaves the client's requested size alone, so the client is still
        // drawing at the right resolution and there is nothing to say.
        this.#placed = undefined;
        // Told the host this element no longer shows that window, so it must
        // stop being true. A disconnect is not always a teardown — moving an
        // element between two containers is a disconnect *and* a reconnect, and
        // children survive the move — so an element that keeps its pixels here
        // keeps them for a window the host has been told it does not hold, and
        // the host will never send the message that clears them.
        //
        // Safe to drop them because the host can put them back: it keeps
        // whatever each app last drew — the buffer for a GPU client and the
        // pixels themselves for a software one — and hands them over on its next
        // pass, whether or not it has a display of its own to draw on. So the
        // window is blank until that pass rather than until its client next
        // happens to draw, which for an app that redraws on input is until the
        // user does something.
        this.dropSurface();
        if (focusedApp() === appId) {
          setFocusedApp(undefined);
          // The window that had the keyboard has gone, so say who has it now.
          // Without this the host is left holding a focus for a client that no
          // longer exists, and the chrome stops receiving keys.
          context.bridge.focusChrome();
        }
      }
    }

    // The DOM hands these back as `string | null`, so `null` is the external
    // API's spelling of "absent" here rather than a value we introduce.
    attributeChangedCallback(
      name: string,
      oldValue: string | null,
      newValue: string | null,
    ): void {
      if (name === "app-id" && this.isConnected && oldValue !== newValue) {
        if (oldValue !== null) {
          context.bridge.removePortal(oldValue);
          // Those pixels — and the resolution they were drawn at — are the *old*
          // app's, and the size is what pointer coordinates are scaled through.
          // Keeping either shows one client's last frame in the element that now
          // stands for another, and maps clicks on the new app through the old
          // one's surface.
          this.dropSurface();
          this.#surfaceWidth = 0;
          this.#surfaceHeight = 0;
          // Whatever the host has been told to forget, this element has to be
          // willing to say again — the same rule as in `disconnectedCallback`.
          // It is tempting to argue the placement carries the app id and so
          // re-places itself: true of a *swap*, and false of a removal, where
          // the `#place()` below does nothing because there is no app to place,
          // and setting the same id back is then deduplicated away against a
          // portal that is no longer in the scene.
          //
          // The render size needs no such clearing, because its key carries the
          // app id too.
          this.#placed = undefined;
        }
        this.#place();
      }
    }

    /**
     * Record the client's own content size, which pointer coordinates are scaled
     * to. Frames carry it, but so does an `app_resized` the client sends before
     * it has redrawn.
     *
     * A size is also what says the client has something to show, which is why the
     * placeholder goes away here rather than when pixels land: where the
     * compositor draws the client's surface itself there are no pixels to land,
     * and a placeholder left up would be drawn over the real window.
     */
    setSurfaceSize(width: number, height: number): void {
      this.#surfaceWidth = width;
      this.#surfaceHeight = height;
      this.classList.add(HAS_SURFACE_CLASS);
    }

    /**
     * Route the keyboard to this app's client. Clicking the element does this
     * too; a chrome calls it directly when it puts the window on screen without
     * a click — opening it, or switching to its tab.
     */
    focusApp(): void {
      this.#withTarget((appId) => {
        setFocusedApp(appId);
        context.bridge.focusApp(appId);
      });
    }

    /**
     * Drop the pixels this element holds, because the compositor is drawing the
     * client's own buffer now.
     *
     * The chrome is composited *over* the client, so a canvas still holding the
     * last copied frame is opaque exactly where the page has to be a hole: the
     * live window would sit behind a still of itself, indefinitely.
     *
     * Only the host can say when this is safe. The element knows what it *asked*
     * for, which is not the same thing — a `wl_shm` client is never drawn
     * natively however ordinary its CSS — and the message arrives after the last
     * copied frame on the same socket, where a guess would race the frames still
     * in flight and one of them would put the canvas straight back.
     *
     * `has-surface` is *set* here, not merely left alone: it says this element
     * has a window behind it, which is as true when the compositor draws it as
     * when a canvas does. A window drawn natively from its first frame never
     * sent a copied one, so nothing else would ever put it on — and a shell
     * that hangs a placeholder off its absence draws "app surface: …" over a
     * live window for as long as that window is open.
     *
     * So does the recorded surface size, which is what pointer coordinates are
     * scaled through and is still the client's resolution when the compositor
     * takes the window over. The one caller that must forget it is the one where
     * the element changes *which app* it shows.
     */
    dropSurface(): void {
      this.#canvas?.remove();
      this.#canvas = undefined;
      // Added rather than assumed, so a shell that hangs a placeholder off its
      // absence does not paint one over a live window.
      this.classList.add(HAS_SURFACE_CLASS);
    }

    /**
     * Point this element's canvas at the window `app-id` names.
     *
     * **This is the whole of how a client's pixels reach the page.** The
     * compositor submits the client's own buffer to a frame sink the browser
     * brokered under this app id; `embedExternalSurface` is what makes this
     * canvas's layer show that surface. Nothing copies anything.
     *
     * Absent outside the forked engine — `embedExternalSurface` is ours, and a
     * chrome running on stock Chromium or Electron does not have it. There the
     * element lays out, reports its box and routes pointers exactly as it does
     * here, and shows nothing: the seam a shell is written against is the same
     * either way, and only the pixels are missing. Said once per element rather
     * than silently, because "no window" with no reason given is the failure
     * this whole path exists to avoid.
     */
    #embedSurface(): void {
      const appId = this.appId;
      if (appId === undefined || this.#canvas !== undefined) {
        return;
      }
      const canvas = createSurfaceCanvas();
      if (canvas.embedExternalSurface === undefined) {
        warnNoExternalSurface();
        return;
      }
      this.#canvas = this.appendChild(canvas);
      this.classList.remove(HAS_SURFACE_CLASS);
      // Rejects if the canvas already has a surface, or if the element goes
      // away while the browser is still holding the reply — both of which are
      // this element being torn down, and neither is worth reporting.
      void canvas.embedExternalSurface(appId).catch(() => undefined);
    }

    /** Show the cursor a client asked for while the pointer is over this app. */
    applyCursor(cursor: CursorShape): void {
      this.style.cursor = cursor;
    }

    #place(): void {
      // Priced whether or not anything is sent, and whether or not it finishes.
      // What costs is the measuring, and the measuring happens every frame for
      // every window — see `placement-timing`.
      //
      // In a `finally` because a window that cannot be measured has already paid
      // for the attempt: `readElementTransform` throws on a computed value it
      // cannot parse, from *after* the layout read, and the loop keeps calling
      // it every frame for the life of the page. Priced only on success, that
      // window would cost the desktop sixty measurements a second and contribute
      // nothing to the number — so the desktop where this matters most is the one
      // it would under-report hardest. Nothing is caught: the throw still reaches
      // the loop, which reports it.
      const started = performance.now();
      try {
        this.#placeNow();
      } finally {
        placementTiming.record(performance.now() - started);
      }
    }

    #placeNow(): void {
      const appId = this.appId;
      if (appId !== undefined) {
        const {
          size,
          transform,
          zIndex,
          visible,
          cornerRadius,
          native,
          opacity,
          shadow,
          takesPointer,
        } = context.measure(this);
        const placement = {
          appId,
          cornerRadius,
          native,
          opacity,
          shadow,
          size,
          takesPointer,
          transform,
          visible,
          zIndex,
        };
        // Measuring happens on every animation frame, so most of the time this
        // is the same window in the same place and there is nothing to say. The
        // key is the placement itself rather than a hand-written comparison,
        // because a comparison that forgot a field would drop exactly the change
        // it forgot — silently, and only for windows that used it.
        const placed = JSON.stringify(placement);
        if (placed !== this.#placed) {
          // Recorded after the send, not before: a throw on the way out would
          // otherwise leave the element sure it had reported a placement the
          // host never received, and nothing would send it again until something
          // else about the window changed.
          context.bridge.placePortal(placement);
          this.#placed = placed;
        }
        // The client renders at its own resolution: without this it would keep
        // drawing at the old size and be stretched into the new box. An element
        // with no box (a hidden tab) has no size to render at, and configuring
        // the client to nothing would make it redraw on every tab switch.
        //
        // Kept apart from the placement because a client redraws when it is
        // configured: a window merely moving must not cost every client on the
        // desktop a repaint.
        // Keyed on the app as well as the size, for the same reason the
        // placement is keyed on the whole message: what identifies this
        // instruction is what it would say, and the app it is about is half of
        // that. Keyed on the size alone it would have to be cleared by hand
        // wherever the app changed — and `attributeChangedCallback` cannot run
        // while the element is detached, so a chrome that swapped `app-id`
        // between a remove and a re-append would leave the new client never
        // configured, drawing at whatever size the previous one asked for.
        const rendered = JSON.stringify({ appId, size });
        if (visible && rendered !== this.#rendered) {
          context.bridge.resizeApp(appId, size);
          this.#rendered = rendered;
        }
      }
    }

    // Pointer input over this element belongs to the client underneath it, in
    // surface-local coordinates. Keyboard input is document-level and is wired up
    // by `registerElements` instead.
    #installPointerForwarding(): void {
      this.addEventListener("pointermove", (event) => {
        this.#withTarget((appId) => {
          this.#forwardMotion(appId, event);
        });
      });

      this.addEventListener("pointerdown", (event) => {
        this.focusApp();
        this.#withTarget((appId) => {
          this.#forwardMotion(appId, event);
          const button = buttonCodeFromJs(event.button);
          if (button !== undefined) {
            context.bridge.pointerButton(appId, button, true);
          }
        });
      });

      this.addEventListener("pointerup", (event) => {
        this.#withTarget((appId) => {
          const button = buttonCodeFromJs(event.button);
          if (button !== undefined) {
            context.bridge.pointerButton(appId, button, false);
          }
        });
      });

      this.addEventListener("pointerleave", () => {
        this.#withTarget((appId) => {
          context.bridge.pointerLeave(appId);
        });
      });

      this.addEventListener(
        "wheel",
        (event) => {
          this.#withTarget((appId) => {
            context.bridge.pointerAxis(appId, axisFromWheel(event));
          });
        },
        { passive: true },
      );
    }

    // Motion is the one forward that needs a layout box: without one there is no
    // surface-local coordinate to report, while focus and button state still are
    // meaningful. The same measurement that placed the portal inverts back to
    // surface coordinates, so any CSS transform on the element is undone here
    // rather than approximated by its axis-aligned box.
    #forwardMotion(appId: string, event: PointerEvent): void {
      const { size, transform } = context.measure(this);
      const local = surfaceLocal(
        transform,
        size,
        [this.#surfaceWidth, this.#surfaceHeight],
        [event.clientX, event.clientY],
      );
      if (local !== undefined) {
        context.bridge.pointerMotion(appId, local.x, local.y);
      }
    }

    // Every pointer handler needs an app-id, and does nothing without one.
    #withTarget(forward: (appId: string) => void): void {
      const appId = this.appId;
      if (appId !== undefined) {
        forward(appId);
      }
    }
  };

/**
 * `canvas.embedExternalSurface(appId)`, which exists only on Domicile's forked
 * engine.
 *
 * Declared here rather than in a global `.d.ts` so it is optional at the type
 * level: every use has to answer what happens without it, which on a stock
 * browser is every use. See `packages/domicile-engine` for the fork, and
 * `docs/architecture/ENGINE-FORK.md` for why a canvas is what shows a window.
 */
declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLCanvasElement {
    embedExternalSurface?: (appId: string) => Promise<void>;
  }
}

/**
 * A canvas for a client's window: no rendering context, no backing store of its
 * own, filled entirely by the surface it embeds.
 */
const createSurfaceCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.className = "domicile-app-surface";
  // A replaced element's own content is clipped to its border radius, but a
  // child is not — so a window given rounded corners by the page would be drawn
  // square by the canvas inside it. Inherited here rather than set as
  // `overflow` on the element, whose inline style belongs to whoever wrote the
  // chrome.
  canvas.style.borderRadius = "inherit";
  // A canvas lays out at its backing store's size in CSS pixels, and this one
  // has no backing store to speak of. Filled to the element, which is what the
  // page laid out and what the client was configured at.
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  return canvas;
};

let warnedNoExternalSurface = false;

/**
 * Say once that this chrome cannot show a window, and why.
 *
 * A page with `<domicile-app>` elements that draw nothing is indistinguishable
 * from a compositor with no clients, from a shell with a layout bug, and from
 * a client that never drew. The reason is knowable here and nowhere else.
 */
const warnNoExternalSurface = (): void => {
  if (warnedNoExternalSurface) {
    return;
  }
  warnedNoExternalSurface = true;
  // biome-ignore lint/suspicious/noConsole: the only channel to the author
  console.warn(
    "domicile: this chrome cannot show a client's window — " +
      "canvas.embedExternalSurface is missing, so it is not running on the " +
      "forked engine. Elements will lay out, report their boxes and route " +
      "pointers as usual, and show nothing.",
  );
};
