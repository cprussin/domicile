// The shell guard-webview-content-script.sh drives: one <webview>, showing one
// page, on the witness color. A domicile:// document because the browser binds
// WebViewGuestHost for the shell's origin only.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = () => {
  /**
   * A query parameter this cannot run without. A default would turn a guard
   * invoked wrongly into a measurement of something nobody asked for.
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

  // Inset, so the witness stays visible around it, and in whole percentages of a
  // window the harness sized, so the flat color lands on integer pixels. As
  // guard-webview-framing.js does, for the same reasons.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  // `src` last: it is what asks for a guest, and the element needs a frame first.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
};
