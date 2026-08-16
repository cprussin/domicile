// The <app> and <webview> custom elements.
//
// Custom element tag names must contain a hyphen, so the SDK registers
// `domicile-app` and `domicile-webview`. The engine integration layer aliases the bare
// `<app>` / `<webview>` names the compositor exposes (we control the engine).
//
// An `<domicile-app>` is a placeholder for a real Wayland client. On connect it
// measures its on-screen box and tells the host to composite the client there;
// on disconnect it tells the host to stop. The host draws the client's actual
// surface into that transformed box, so the app inherits full CSS.
//
// A `<domicile-webview>` is rendered by the engine directly (a nested browsing
// context), so the element itself is just a typed marker.

import { accumulate } from "./matrix.js";
import { decodeBase64ToBytes } from "./frame.js";
import { buttonCodeFromJs, evdevFromCode, surfaceLocal } from "./input.js";

let activeBridge = null;
let measureFn = defaultMeasure;
// The app currently receiving keyboard input (set when an <app> is clicked).
let focusedAppId = null;
let globalInputInstalled = false;

/**
 * Wire the SDK to a bridge and define the custom elements. Idempotent: safe to
 * call once at chrome startup. `measure` may be overridden (tests inject a stub
 * because jsdom performs no layout).
 */
export function registerElements(bridge, { measure } = {}) {
  activeBridge = bridge;
  if (measure) measureFn = measure;
  installGlobalInput();
  if (typeof customElements === "undefined") return;
  if (!customElements.get("domicile-app")) customElements.define("domicile-app", DomicileAppElement);
  if (!customElements.get("domicile-webview")) customElements.define("domicile-webview", DomicileWebviewElement);
}

// Document-level keyboard forwarding + click-to-focus-chrome. Keyboard events
// are global, so they're routed to whichever <app> was last clicked.
function installGlobalInput() {
  if (globalInputInstalled || typeof document === "undefined") return;
  globalInputInstalled = true;

  const onKey = (e) => {
    if (!focusedAppId || !activeBridge) return;
    const keycode = evdevFromCode(e.code);
    if (keycode == null) return;
    e.preventDefault();
    activeBridge.key(focusedAppId, keycode, e.type === "keydown");
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKey);

  // Clicking outside any <app> returns keyboard focus to the chrome.
  document.addEventListener("pointerdown", (e) => {
    const onApp = e.target && e.target.closest && e.target.closest("domicile-app");
    if (!onApp && focusedAppId) {
      focusedAppId = null;
      activeBridge?.focusChrome();
    }
  });
}

export class DomicileAppElement extends HTMLElement {
  static observedAttributes = ["app-id"];

  get appId() {
    return this.getAttribute("app-id");
  }
  set appId(value) {
    this.setAttribute("app-id", value);
  }

  connectedCallback() {
    this._installPointer();
    this._place();
  }

  disconnectedCallback() {
    if (this.appId && activeBridge) activeBridge.removePortal(this.appId);
    if (focusedAppId === this.appId) focusedAppId = null;
  }

  // Forward pointer input over this element to the client (surface-local).
  _installPointer() {
    if (this._pointerInstalled) return;
    this._pointerInstalled = true;

    const localOf = (e) =>
      surfaceLocal(this.getBoundingClientRect(), e.clientX, e.clientY, this._surfaceWidth, this._surfaceHeight);

    this.addEventListener("pointermove", (e) => {
      const local = localOf(e);
      if (local && activeBridge && this.appId) activeBridge.pointerMotion(this.appId, local.x, local.y);
    });
    this.addEventListener("pointerdown", (e) => {
      if (!this.appId || !activeBridge) return;
      focusedAppId = this.appId;
      activeBridge.focusApp(this.appId);
      const local = localOf(e);
      if (local) activeBridge.pointerMotion(this.appId, local.x, local.y);
      const button = buttonCodeFromJs(e.button);
      if (button != null) activeBridge.pointerButton(this.appId, button, true);
    });
    this.addEventListener("pointerup", (e) => {
      const button = buttonCodeFromJs(e.button);
      if (button != null && activeBridge && this.appId) activeBridge.pointerButton(this.appId, button, false);
    });
    this.addEventListener("pointerleave", () => {
      if (activeBridge && this.appId) activeBridge.pointerLeave(this.appId);
    });
    this.addEventListener(
      "wheel",
      (e) => {
        if (activeBridge && this.appId) activeBridge.pointerAxis(this.appId, e.deltaX, e.deltaY);
      },
      { passive: true },
    );
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
    this._surfaceWidth = width;
    this._surfaceHeight = height;
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
      this._canvas.className = "domicile-app-surface";
      this.appendChild(this._canvas);
    }
  }
}

export class DomicileWebviewElement extends HTMLElement {
  static observedAttributes = ["src"];

  get src() {
    return this.getAttribute("src");
  }
  set src(value) {
    this.setAttribute("src", value);
  }

  connectedCallback() {
    this._ensureView();
  }

  attributeChangedCallback(name) {
    if (name === "src") this._ensureView();
  }

  // Embed the content. In the Electron host this is a real <webview> (a separate
  // browsing context, so it can load sites that forbid <iframe> embedding); the
  // eventual engine maps <domicile-webview> to a native CEF browsing context.
  _ensureView() {
    if (!this._view) {
      this._view = document.createElement("webview");
      this._view.className = "domicile-webview-frame";
      this.appendChild(this._view);
    }
    if (this.src) this._view.setAttribute("src", this.src);
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
