// The `<domicile-app>` custom element: a placeholder for a real Wayland client.
//
// On connect it measures its on-screen box and tells the host to composite the
// client there; on disconnect it tells the host to stop. The host draws the
// client's actual surface into that transformed box, so the app inherits full
// CSS — that is the whole point of Domicile.
//
// Custom element tag names must contain a hyphen, so the SDK registers
// `domicile-app`. The engine integration layer aliases the bare `<app>` name
// the compositor exposes (we control the engine).

import type { BridgeClient } from "./bridge";
import {
  activeBridge,
  activeMeasure,
  focusedApp,
  setFocusedApp,
} from "./element-context";
import { decodeBase64ToBytes } from "./frame";
import { buttonCodeFromJs, surfaceLocal } from "./input";

const BYTES_PER_PIXEL = 4;

/** The class name the shell stylesheet uses to hide the empty placeholder. */
const HAS_SURFACE_CLASS = "has-surface";

export class DomicileAppElement extends HTMLElement {
  static observedAttributes = ["app-id"];

  #canvas: HTMLCanvasElement | undefined;
  #surfaceWidth = 0;
  #surfaceHeight = 0;

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
  }

  disconnectedCallback(): void {
    const appId = this.appId;
    if (appId !== undefined) {
      activeBridge()?.removePortal(appId);
      if (focusedApp() === appId) {
        setFocusedApp(undefined);
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
        activeBridge()?.removePortal(oldValue);
      }
      this.#place();
    }
  }

  /** Draw a client frame (raw RGBA, base64) into this element's canvas. */
  drawFrame(width: number, height: number, base64: string): void {
    this.#surfaceWidth = width;
    this.#surfaceHeight = height;
    const canvas = this.#ensureCanvas();
    const context = canvas.getContext("2d");
    // A DOM implementation without a 2d context (test environments) still
    // exercises the canvas-creation path above; there is nothing to draw into.
    if (context !== null) {
      // Assigning either dimension resets the canvas, so only do it when the
      // surface actually changed size.
      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }
      const bytes = decodeBase64ToBytes(base64);
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(
            bytes.buffer,
            bytes.byteOffset,
            width * height * BYTES_PER_PIXEL,
          ),
          width,
          height,
        ),
        0,
        0,
      );
      this.classList.add(HAS_SURFACE_CLASS);
    }
  }

  #place(): void {
    const appId = this.appId;
    const bridge = activeBridge();
    if (appId !== undefined && bridge !== undefined) {
      const { size, transform, zIndex, visible } = activeMeasure()(this);
      bridge.placePortal({ appId, size, transform, visible, zIndex });
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
      this.#withTarget((bridge, appId) => {
        this.#forwardMotion(bridge, appId, event);
      });
    });

    this.addEventListener("pointerdown", (event) => {
      this.#withTarget((bridge, appId) => {
        setFocusedApp(appId);
        bridge.focusApp(appId);
        this.#forwardMotion(bridge, appId, event);
        const button = buttonCodeFromJs(event.button);
        if (button !== undefined) {
          bridge.pointerButton(appId, button, true);
        }
      });
    });

    this.addEventListener("pointerup", (event) => {
      this.#withTarget((bridge, appId) => {
        const button = buttonCodeFromJs(event.button);
        if (button !== undefined) {
          bridge.pointerButton(appId, button, false);
        }
      });
    });

    this.addEventListener("pointerleave", () => {
      this.#withTarget((bridge, appId) => {
        bridge.pointerLeave(appId);
      });
    });

    this.addEventListener(
      "wheel",
      (event) => {
        this.#withTarget((bridge, appId) => {
          bridge.pointerAxis(appId, event.deltaX, event.deltaY);
        });
      },
      { passive: true },
    );
  }

  // Motion is the one forward that needs a layout box: without one there is no
  // surface-local coordinate to report, while focus and button state still are
  // meaningful.
  #forwardMotion(
    bridge: BridgeClient,
    appId: string,
    event: PointerEvent,
  ): void {
    const local = surfaceLocal(
      this.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      this.#surfaceWidth,
      this.#surfaceHeight,
    );
    if (local !== undefined) {
      bridge.pointerMotion(appId, local.x, local.y);
    }
  }

  // Every pointer handler needs a bound bridge and an app-id, and does nothing
  // without them.
  #withTarget(forward: (bridge: BridgeClient, appId: string) => void): void {
    const bridge = activeBridge();
    const appId = this.appId;
    if (bridge !== undefined && appId !== undefined) {
      forward(bridge, appId);
    }
  }
}

const createSurfaceCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.className = "domicile-app-surface";
  return canvas;
};
