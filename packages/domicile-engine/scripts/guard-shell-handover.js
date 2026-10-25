// The shell guard-shell-handover.sh drives. It reports what the engine called
// it with, whether anything else on the page can find the desktop, and whether
// the page drew while the module loaded:
//
//   GUARD handover root=<body|…> desktop=<yes|no> navigator=<none|…>
//                  window=<none|…> held=<yes|no>
//   GUARD handover drawn
//
// The second line comes with the first frame after `Shell` returns.

import { framesSoFar } from "./guard-shell-handover-frames.js";

// A slow module: long enough for a page that is not held to draw many frames.
await new Promise((resolve) => {
  setTimeout(resolve, 1000);
});

export const Shell = (root, desktop) => {
  // The SDK layer's `Domicile`, not the host under it: namespaced, with no
  // `addEventListener` of its own.
  const answers =
    typeof desktop?.windows?.on === "function" &&
    !("addEventListener" in desktop);
  console.log(
    "GUARD handover" +
      ` root=${root === document.body ? "body" : String(root)}` +
      ` desktop=${answers ? "yes" : "no"}` +
      ` navigator=${"domicile" in navigator ? "present" : "none"}` +
      ` window=${"domicile" in window ? "present" : "none"}` +
      ` held=${framesSoFar() === 0 ? "yes" : "no"}`,
  );
  requestAnimationFrame(() => {
    console.log("GUARD handover drawn");
  });
};
