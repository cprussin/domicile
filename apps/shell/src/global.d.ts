import type { HostChannel } from "@domicile/chrome-sdk/host-transport";

import type { Chord } from "./chord";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration-merging Window requires interface
  interface Window {
    /**
     * Injected by the host (the preload, in the Electron prototype). The small
     * half of the transport: the pixels arrive by `postMessage` instead, which
     * moves them rather than cloning them.
     */
    domicileHost?: HostChannel;
    /**
     * A way to print a line where a terminal can see it, which a renderer has
     * no other route to. Injected by the Electron preload only, so it is absent
     * when the shell is opened in a plain browser.
     */
    domicileDiagnostics?: {
      report: (line: string) => void;
    };
    /**
     * The Electron host's grab on the pages this one embeds. A `<webview>` is
     * a browsing context of its own, so a key pressed in one never reaches
     * this page — the host takes the claimed combinations out of the guest's
     * stream and hands each press back here. Injected by the Electron preload
     * only: a plain browser embeds nothing, and where Domicile composites this
     * window the compositor's own grab is what takes the key.
     */
    domicileGuestShortcuts?: {
      grab: (chord: Chord) => void;
      /** There is one listener: registering replaces it. */
      onPressed: (listener: (chord: Chord) => void) => void;
    };
  }
}

export {};
