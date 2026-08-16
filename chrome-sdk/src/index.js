// Loom chrome SDK — public surface used by chrome shells.
//
// A shell typically does:
//   import { BridgeClient, registerElements } from "@loom/chrome-sdk";
//   const bridge = new BridgeClient(window.loomTransport);
//   registerElements(bridge);
//   await bridge.connect();
// then renders <loom-app app-id="…"> / <loom-webview src="…"> as normal DOM.

export { BridgeClient } from "./bridge.js";
export { registerElements, LoomAppElement, LoomWebviewElement } from "./elements.js";
export { decodeBase64ToBytes } from "./frame.js";
export * as matrix from "./matrix.js";
export {
  placePortalMessage,
  removePortalMessage,
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  PROTOCOL_VERSION,
} from "./placement.js";
