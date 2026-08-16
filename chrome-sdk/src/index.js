// Domicile chrome SDK — public surface used by chrome shells.
//
// A shell typically does:
//   import { BridgeClient, registerElements } from "@domicile/chrome-sdk";
//   const bridge = new BridgeClient(window.domicileTransport);
//   registerElements(bridge);
//   await bridge.connect();
// then renders <domicile-app app-id="…"> / <domicile-webview src="…"> as normal DOM.

export { BridgeClient } from "./bridge.js";
export { registerElements, DomicileAppElement, DomicileWebviewElement } from "./elements.js";
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
