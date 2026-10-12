// The shell guard-app-only-in-shell.sh drives. It reports whether <app> exists
// here, then shows `?src=` in a <webview>, whose page reports the same. See
// guard-app-only-in-shell-server.py.
//
//   GUARD shell element=<app|unknown> interface=<defined|undefined>
//               embed=<defined|undefined>
//
// Domicile calls `Shell` once the module loads.

export const Shell = (root) => {
  const app = document.createElement("app");
  console.log(
    "GUARD shell" +
      ` element=${app instanceof HTMLUnknownElement ? "unknown" : "app"}` +
      ` interface=${"HTMLAppElement" in window ? "defined" : "undefined"}` +
      ` embed=${typeof document.createElement("canvas").embedExternalSurface === "function" ? "defined" : "undefined"}`,
  );

  const src = new URLSearchParams(location.search).get("src");
  if (src === null) {
    throw new Error("guard-app-only-in-shell: ?src= is required");
  } else {
    const view = document.createElement("webview");
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    // Set `src` after attaching: it requests the guest, which needs a frame.
    root.append(view);
    view.setAttribute("src", src);
  }
};
