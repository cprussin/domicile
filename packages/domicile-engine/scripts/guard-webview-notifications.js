// The shell guard-webview-notifications.sh drives: one browser window, showing
// one page that asks what it may do.
//
// A module rather than a page, for guard-webview-framing.js's reasons: that is
// what a shell is here, and only the shell's origin may ask for a guest.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = () => {
  /** A query parameter this cannot run without. */
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

  // Inset, so the witness color stays visible around it, and in whole
  // percentages, so the flat color inside lands on integer pixels.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  // In the document before `src`, for guard-webview-framing.js's reason.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
};
