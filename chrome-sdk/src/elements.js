// The <app> and <webview> custom elements.
//
// Custom element tag names must contain a hyphen, so the SDK registers
// `loom-app` and `loom-webview`. The engine integration layer aliases the bare
// `<app>` / `<webview>` names the compositor exposes (we control the engine).
//
// An `<loom-app>` is a placeholder for a real Wayland client. On connect it
// measures its on-screen box and tells the host to composite the client there;
// on disconnect it tells the host to stop. The host draws the client's actual
// surface into that transformed box, so the app inherits full CSS.
//
// A `<loom-webview>` is rendered by the engine directly (a nested browsing
// context), so the element itself is just a typed marker.

import { accumulate } from "./matrix.js";
import { decodeBase64ToBytes } from "./frame.js";

let activeBridge = null;
let measureFn = defaultMeasure;

/**
 * Wire the SDK to a bridge and define the custom elements. Idempotent: safe to
 * call once at chrome startup. `measure` may be overridden (tests inject a stub
 * because jsdom performs no layout).
 */
export function registerElements(bridge, { measure } = {}) {
  activeBridge = bridge;
  if (measure) measureFn = measure;
  if (typeof customElements === "undefined") return;
  if (!customElements.get("loom-app")) customElements.define("loom-app", LoomAppElement);
  if (!customElements.get("loom-webview")) customElements.define("loom-webview", LoomWebviewElement);
}

export class LoomAppElement extends HTMLElement {
  static observedAttributes = ["app-id"];

  get appId() {
    return this.getAttribute("app-id");
  }
  set appId(value) {
    this.setAttribute("app-id", value);
  }

  connectedCallback() {
    this._place();
  }

  disconnectedCallback() {
    if (this.appId && activeBridge) activeBridge.removePortal(this.appId);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name !== "app-id" || !this.isConnected || oldValue === newValue) return;
    if (oldValue && activeBridge) activeBridge.removePortal(oldValue);
    this._place();
  }

  _place() {
    if (!this.appId || !activeBridge) return;
    const { size, transform, zIndex, visible } = measureFn(this);
    activeBridge.placePortal({ appId: this.appId, size, transform, zIndex, visible });
  }

  /** Draw a client frame (raw RGBA, base64) into this element's canvas. */
  drawFrame(width, height, base64) {
    this._ensureCanvas();
    const ctx = this._canvas.getContext("2d");
    if (!ctx) return; // e.g. jsdom has no 2d context
    if (this._canvas.width !== width) this._canvas.width = width;
    if (this._canvas.height !== height) this._canvas.height = height;
    const bytes = decodeBase64ToBytes(base64);
    const image = new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, width * height * 4), width, height);
    ctx.putImageData(image, 0, 0);
    this.classList.add("has-surface");
  }

  _ensureCanvas() {
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._canvas.className = "loom-app-surface";
      this.appendChild(this._canvas);
    }
  }
}

export class LoomWebviewElement extends HTMLElement {
  get src() {
    return this.getAttribute("src");
  }
  set src(value) {
    this.setAttribute("src", value);
  }
}

/**
 * Default DOM measurement: element-local size plus an element->screen affine.
 *
 * This first cut reports size + translation (via getBoundingClientRect) and the
 * element's own computed linear transform. Precise full-chain transform capture
 * (ancestor rotation/scale, transform-origin, 3D) is provided by the engine
 * integration, which already knows each layer's transform; that path replaces
 * this when running inside the compositor.
 */
function defaultMeasure(element) {
  const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const size = [element.offsetWidth || rect.width || 0, element.offsetHeight || rect.height || 0];

  let linear = [1, 0, 0, 1, 0, 0];
  try {
    const t = getComputedStyle(element).transform;
    if (t && t !== "none" && typeof DOMMatrix !== "undefined") {
      const m = new DOMMatrix(t);
      linear = [m.a, m.b, m.c, m.d, 0, 0];
    }
  } catch {
    // No computed transform available; fall back to identity linear part.
  }

  const transform = accumulate([linear, [1, 0, 0, 1, rect.left || 0, rect.top || 0]]);
  const visible = size[0] > 0 && size[1] > 0;
  return { size, transform, zIndex: readZIndex(element), visible };
}

function readZIndex(element) {
  try {
    const z = parseInt(getComputedStyle(element).zIndex, 10);
    return Number.isFinite(z) ? z : 0;
  } catch {
    return 0;
  }
}
