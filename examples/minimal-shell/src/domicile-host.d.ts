import type { HostChannel } from "@domicile/chrome-sdk/host-transport";

// What `preload.ts` exposes on the page. Declared rather than imported: the
// preload runs in another context, so the page only ever sees this shape.
//
// `HostChannel` is the SDK's own name for it, and `postedTransport` takes one —
// so getting this wrong makes the page's single connection to the SDK
// unchecked. `tsconfig.json` therefore keeps `skipLibCheck` off: a `.d.ts` is
// exactly what that flag stops checking, and this is a `.d.ts`.
declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into `Window` requires an interface
  interface Window {
    domicileHost: HostChannel | undefined;
  }
}
