// What the engine evaluates to build the desktop it hands a shell's `Shell` or
// an app's `main`. `codegen/generate-engine-layer.ts` bundles it into the
// engine; see "The desktop layer" in packages/chrome-sdk/README.md.

export { appDesktop } from "./app-desktop";
export { desktop } from "./desktop";
