// The `<domicile-app>` custom element: a placeholder for a real Wayland client.
//
// The element embeds the client's surface, so where the window is drawn is
// whatever CSS does to this element — nothing here reports a position. What it
// does report is the box the page laid out, because that is the resolution the
// client has to be configured at, and only the page knows it.
//
// Custom element tag names must contain a hyphen, so the SDK registers
// `domicile-app`. A chrome that prefers the bare `<app>` the compositor exposes
// gets it from `aliasTag` until the engine makes the short name real.

import type { CursorShape } from "./cursor-shape";
import type { ElementContext } from "./element-context";
import { focusedApp, setFocusedApp } from "./element-context";
import { buttonCodeFromJs } from "./input";
import { placementTiming } from "./placement-timing";
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
  /** The host's name for the client this element shows. */
  get appId(): string | undefined;
  set appId(value: string);
  /** Tell the host the client should be this many logical pixels. */
  setSurfaceSize(width: number, height: number): void;
  /** Put the keyboard on this client without a click. */
  focusApp(): void;
  /** Show the cursor the client under this element asked for. */
  applyCursor(cursor: CursorShape): void;
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
    // The last render size sent, so a measurement that changed nothing costs
    // nothing. See `#reportSize`.
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
      this.#reportSize();
      // CSS resizes the element without any of this code running — a layout
      // change anywhere above it, a transition, a class toggle — so the size
      // has to follow the box rather than be reported once. A client left at
      // the old resolution is stretched into the new box.
      this.#unobserve = context.observePlacement(() => {
        this.#reportSize();
      });
    }

    disconnectedCallback(): void {
      this.#unobserve?.();
      this.#unobserve = undefined;
      const appId = this.appId;
      if (appId !== undefined) {
        // This element no longer shows that window, so it must stop showing
        // one. A disconnect is not always a teardown — moving an element
        // between two containers is a disconnect *and* a reconnect, and
        // children survive the move — so an element that kept its canvas here
        // would go on showing a window it no longer stands for.
        //
        // Safe because the reconnect embeds again: the surface belongs to the
        // compositor and outlives any canvas pointed at it, so what comes back
        // is the live window rather than the last thing drawn in it.
        this.#dropSurface();
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
          // That canvas shows the *old* app's window, and the recorded size is
          // the old client's resolution — which is what pointer coordinates are
          // scaled through. Keeping either shows one client in the element that
          // now stands for another, and maps clicks on the new app through the
          // old one's surface.
          //
          // The render size needs no such clearing, because its key carries the
          // app id: the new client is configured on its own account.
          this.#dropSurface();
          this.#surfaceWidth = 0;
          this.#surfaceHeight = 0;
        }
        // A window of its own for whatever this element now stands for. The
        // embed runs from `connectedCallback`, which a swap does not re-run —
        // so without this the element that swapped keeps the hole where the
        // old app's canvas was and shows nothing until it is remounted.
        this.#embedSurface();
        this.#reportSize();
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
     * Give up the canvas this element was showing a window in.
     *
     * The canvas *is* the window — it embeds the surface the compositor submits
     * to — so this is only ever right when the element has stopped standing for
     * the app whose window that is: a disconnect, or a swap to another app id.
     * Both re-embed rather than leave the element empty.
     *
     * `has-surface` goes with it. The class says this element has something
     * behind it, and the honest source for that is the client's own reported
     * size — `setSurfaceSize` — which arrives whether or not any pixel ever
     * reaches the page. An element with no canvas and no size has nothing
     * behind it, and a shell hanging its placeholder off the class's absence
     * should be showing that placeholder.
     */
    #dropSurface(): void {
      this.#canvas?.remove();
      this.#canvas = undefined;
      this.classList.remove(HAS_SURFACE_CLASS);
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
      // A REFUSAL IS ONLY UNINTERESTING IF THIS ELEMENT IS GONE. It rejects
      // when the element goes away while the browser is still holding the
      // reply, which is a teardown and says nothing; and it rejects when the
      // browser will not give this canvas the surface, which is a window that
      // shows `app surface: …` over a running client for as long as it is
      // open. This used to swallow both, on the claim that they were the same
      // event — they are not, and the difference is exactly whether the
      // element is still in the document when the answer lands.
      //
      // Observed on a real desktop before this said anything: a terminal moved
      // into a floating window went to the placeholder and stayed there, with
      // nothing in any log to say the embed had been refused at all.
      void canvas.embedExternalSurface(appId).catch((refusal: unknown) => {
        if (!this.isConnected) {
          return;
        }
        // biome-ignore lint/suspicious/noConsole: the only channel to the author
        console.error(
          `domicile: the engine refused this chrome a surface for ${appId}, so` +
            " its window will not be shown. The element is still on the page" +
            " and still routing pointers; only the pixels are missing.",
          refusal,
        );
      });
    }

    /** Show the cursor a client asked for while the pointer is over this app. */
    applyCursor(cursor: CursorShape): void {
      this.style.cursor = cursor;
    }

    // Tell the host what resolution to configure this element's client at.
    //
    // Priced whether or not anything is sent, and whether or not it finishes.
    // What costs is the measuring, and the measuring happens every frame for
    // every window — see `placement-timing`.
    //
    // In a `finally` because a window that cannot be measured has already paid
    // for the attempt: `readElementTransform` throws on a computed value it
    // cannot parse, from *after* the layout read, and the loop keeps calling
    // it every frame for the life of the page. Priced only on success, that
    // window would cost the desktop sixty measurements a second and contribute
    // nothing to the number — so the desktop where this matters most is the
    // one it would under-report hardest. Nothing is caught: the throw still
    // reaches the loop, which reports it.
    #reportSize(): void {
      const started = performance.now();
      try {
        const appId = this.appId;
        if (appId !== undefined) {
          const { size, visible } = context.measure(this);
          // The client renders at its own resolution: without this it would
          // keep drawing at the old size and be stretched into the new box. An
          // element with no box (a hidden tab) has no size to render at, and
          // configuring the client to nothing would make it redraw on every tab
          // switch.
          //
          // Measuring happens on every animation frame, so most of the time
          // this is the same window at the same size and there is nothing to
          // say — which matters here more than anywhere, because a client
          // redraws whenever it is configured.
          //
          // Keyed on the app as well as the size: what identifies this
          // instruction is what it would say, and the app it is about is half
          // of that. Keyed on the size alone it would have to be cleared by
          // hand wherever the app changed — and `attributeChangedCallback`
          // cannot run while the element is detached, so a chrome that swapped
          // `app-id` between a remove and a re-append would leave the new
          // client never configured, drawing at whatever size the previous one
          // asked for.
          const rendered = JSON.stringify({ appId, size });
          if (visible && rendered !== this.#rendered) {
            // Recorded after the send, not before: a throw on the way out would
            // otherwise leave the element sure it had reported a size the host
            // never received, and nothing would send it again until the window
            // changed size.
            context.bridge.resizeApp(appId, size);
            this.#rendered = rendered;
          }
        }
      } finally {
        placementTiming.record(performance.now() - started);
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
    // meaningful. The element's own element->screen affine inverts back to
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
