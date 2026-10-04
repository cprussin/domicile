// Shell for guard-webview-content-script.sh: one <webview> on a witness color.
// Loaded on a domicile:// page, the only origin WebViewGuestHost is bound for.
// Domicile calls `Shell` once the module loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured run fails.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-content-script: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const parameters = new URLSearchParams(location.search);
  const view = document.createElement("webview");

  // Inset so the witness color shows around it, in whole percentages so edges
  // land on integer pixels.
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
