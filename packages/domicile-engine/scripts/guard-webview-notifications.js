// The shell module for guard-webview-notifications.sh: one browser window
// showing a page that asks for a permission.
//
// A module on the shell's origin, since only that origin may ask for a guest
// (see guard-webview-framing.js). The shell document calls `Shell` once the
// module loads.

export const Shell = () => {
  /** Reads a required query parameter. */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-notifications: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const parameters = new URLSearchParams(location.search);
  const view = document.createElement("webview");

  // Inset, so the witness color shows around it. Whole percentages keep the
  // edges on integer pixels.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  // Append before setting `src`: a <webview> needs a frame to attach a guest.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
};
