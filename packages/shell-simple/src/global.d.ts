import type { HostChannel } from "@domicile/chrome-sdk/host-transport";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration-merging Window requires interface
  interface Window {
    /**
     * Injected by the host (the preload, in the Electron prototype). The small
     * half of the transport: the pixels arrive by `postMessage` instead, which
     * moves them rather than cloning them.
     */
    domicileHost?: HostChannel;
  }
}

export {};
