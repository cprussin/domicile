// The shell guard-webview-untrusted-cert.sh runs: one browser window on an
// https page, logging the address and security the element reports.
//
// Logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                   the module ran
//   GUARD page-state security=… url=…    each `domicile-page-change`
//
// The page itself logs `GUARD guest-loaded` (guard-webview-guest-page.py),
// which only a trusted connection reaches.

export const HostShell = () => {
  const src = new URLSearchParams(location.search).get("src");
  if (src === null) {
    throw new Error("guard-webview-untrusted-cert: ?src= is required");
  } else {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.border = "0";
    document.body.append(view);
    // `url` last, so a URL with a space cannot hide the security reading.
    view.addEventListener("domicile-page-change", () => {
      console.log(`GUARD page-state security=${view.security} url=${view.url}`);
    });
    view.setAttribute("src", src);
    console.log("GUARD shell-loaded");
  }
};
