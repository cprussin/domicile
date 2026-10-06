// Shell for guard-webview-framing.sh: one <webview> showing one site.
//
// A module, because the engine writes the shell document and loads one module
// (see ShellURLLoaderFactory::ShellDocument). Loaded on a domicile:// page, the
// only origin WebViewGuestHost is bound for.
//
// The control is not here: an <iframe> on a domicile:// page never loads http
// pages. See guard-webview-framing-server.py.
//
// Domicile calls `Shell` once the module loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured run fails.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-framing: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const parameters = new URLSearchParams(location.search);
  const view = document.createElement("webview");

  // Inset so the witness color shows around it; the probe needs the witness to
  // know anything drew (see engine_color_probe.cc). Whole percentages keep edges
  // on integer pixels, and match the control's <iframe>. No `transform`: it
  // changes a surface-backed element's edge pixels, and the probe matches
  // colors exactly.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  // Set `src` after attaching: it requests the guest, which needs a frame.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
};
