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

const BYTES_PER_PIXEL = 4;

/** The class name the shell stylesheet uses to hide the empty placeholder. */
const HAS_SURFACE_CLASS = "has-surface";

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
export const createAppElement = (context: ElementContext) =>
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
     * `has-surface` stays: it says this element has a window behind it, which is
     * as true when the compositor draws it as when a canvas does. Putting the
     * placeholder back would draw "app surface: …" over a live window.
     *
     * So does the recorded surface size, which is what pointer coordinates are
     * scaled through and is still the client's resolution when the compositor
     * takes the window over. The one caller that must forget it is the one where
     * the element changes *which app* it shows.
     */
    dropSurface(): void {
      this.#canvas?.remove();
      this.#canvas = undefined;
    }

    /** Show the cursor a client asked for while the pointer is over this app. */
    applyCursor(cursor: CursorShape): void {
      this.style.cursor = cursor;
    }

    /**
     * Draw a client frame (raw row-major RGBA) into this element's canvas.
     *
     * `width` and `height` are the buffer's own device pixels and `scale` says
     * how many of those the client drew per logical unit. The two are only the
     * same number at scale 1: the canvas backing store takes the pixels, while
     * the surface size — what pointer coordinates are mapped through — is
     * logical.
     */
    drawFrame(
      width: number,
      height: number,
      scale: number,
      pixels: Uint8Array<ArrayBuffer>,
      region?: readonly [x: number, y: number, width: number, height: number],
    ): void {
      // A scale of zero would divide the surface out of existence; it can only
      // arrive from a host that disagrees with this build about the protocol.
      const logical = Math.max(1, Math.trunc(scale));
      this.setSurfaceSize(width / logical, height / logical);
      const canvas = this.#ensureCanvas();
      // The backing store is the buffer's device pixels while CSS keeps the
      // element its logical size, which is what puts one canvas pixel on one
      // display pixel. Assigning either dimension resets the canvas, so only do
      // it when the surface actually changed size.
      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }
      // Not `context`: that name is the element's collaborators, closed over
      // by the whole class, and a canvas that shadowed it would let an edit in
      // here reach for `context.bridge` and typecheck against the wrong thing.
      const canvasContext = canvas.getContext("2d");
      // A DOM implementation without a 2d context (test environments) still
      // exercises the canvas-creation and sizing paths above; there is nothing
      // to draw into.
      if (canvasContext !== null) {
        // A partial frame is only the part the client changed, so its rows are
        // the *region's* width and it lands at the region's corner. Sizing the
        // patch by the buffer would read past the bytes that arrived; placing it
        // at the origin would draw the window out of its own top-left corner.
        const [x, y, patchWidth, patchHeight] = region ?? [0, 0, width, height];
        canvasContext.putImageData(
          new ImageData(
            new Uint8ClampedArray(
              pixels.buffer,
              pixels.byteOffset,
              patchWidth * patchHeight * BYTES_PER_PIXEL,
            ),
            patchWidth,
            patchHeight,
          ),
          x,
          y,
        );
      }
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

    #ensureCanvas(): HTMLCanvasElement {
      this.#canvas ??= this.appendChild(createSurfaceCanvas());
      return this.#canvas;
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

/** An instance of what `createAppElement` builds. */
export type DomicileAppElement = InstanceType<
  ReturnType<typeof createAppElement>
>;

const createSurfaceCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.className = "domicile-app-surface";
  // On the copy path the client's pixels are ordinary content, and the box
  // that holds them does not clip them: `border-radius` on the element rounds
  // the element and does nothing to a child. A window sent down this path
  // *because* of its radius would then be drawn square by the very path meant
  // to draw it round.
  //
  // On the canvas rather than as `overflow` on the element, because a replaced
  // element's own content *is* clipped to its border radius — and the
  // element's inline style belongs to whoever wrote the chrome, not to us.
  canvas.style.borderRadius = "inherit";
  // Filled to the element, because a canvas has no size of its own beyond its
  // backing store: it lays out at the *buffer's* dimensions, in CSS pixels.
  // Left to itself it draws the window at whatever size the client last drew
  // at, so the same window changes size when it falls to this path. On a 2x
  // display that is twice the element, permanently; at any scale it is wrong
  // for as long as the element and the buffer disagree, which is every resize
  // until the client has answered it.
  //
  // Not a style choice a chrome makes — a chrome that wants the window a
  // different size sizes the *element*. Two limits on how far this follows it:
  // a percentage resolves against the element's *content* box while the
  // compositor draws across its border box, so padding on a `<domicile-app>`
  // insets this path's window and not the other's; and where the element has
  // no definite block size, `100%` computes to `auto` and a replaced element
  // then takes its block size from its aspect ratio rather than filling.
  // Neither is reachable from the shell in this repo, whose windows are
  // `position: absolute; inset: 0` with no padding.
  //
  // `display` with them: a canvas is inline by default, and an inline box sits
  // on the text baseline with a descender's worth of gap beneath it — enough
  // to show a strip of whatever is behind the window. A chrome with a CSS
  // reset already gets this; the SDK cannot assume one.
  canvas.style.display = "block";
  canvas.style.inlineSize = "100%";
  canvas.style.blockSize = "100%";
  return canvas;
};
