import type { Transport } from "@domicile/chrome-sdk/bridge";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration-merging Window requires interface
  interface Window {
    /** Injected by the host (the preload, in the Electron prototype). */
    domicileTransport?: Transport;
    /**
     * A way to print a line where a terminal can see it, which a renderer has
     * no other route to. Injected by the Electron preload only, so it is absent
     * when the shell is opened in a plain browser.
     */
    domicileDiagnostics?: {
      report: (line: string) => void;
    };
  }
}

export {};
