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
     * Saying why and stopping, which a renderer can do neither half of: the
     * file descriptor the reason goes to and the exit are the main process's.
     * The preload reports a dead socket through the same channel — this is the
     * page's way in, for the failure only the page can see.
     *
     * Injected by the Electron preload only. A shell opened in a plain browser
     * has nothing to stop and, with a no-op transport, no handshake to fail.
     */
    domicileFailure?: {
      /** The line goes to stderr as written, newline and all. */
      report: (line: string, code: number) => void;
    };
    /**
     * The window this page is drawn in, which belongs to the Electron main
     * process. The desktop's size arrives on this renderer's socket and the
     * window is not the renderer's to resize, so the two are joined here.
     *
     * Injected by the Electron preload only, so a plain browser has none — its
     * window is the user's. Present but unanswered where Domicile composites
     * this window: the preload cannot tell the two apart, and `main.ts`, which
     * can, wires the channel up only where the size is its to act on.
     */
    domicileWindow?: {
      /** Logical pixels, and the window's *content* rather than its frame. */
      sizeToDesktop: (width: number, height: number) => void;
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
