import type { Transport } from "@domicile/chrome-sdk/bridge";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration-merging Window requires interface
  interface Window {
    /** Injected by the host (the preload, in the Electron prototype). */
    domicileTransport?: Transport;
  }
}

export {};
