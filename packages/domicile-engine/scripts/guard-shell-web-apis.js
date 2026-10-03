// The shell guard-shell-web-apis.sh drives: the shell's own page asking the
// two things a widget on its bar needs -- whether it may show a notification,
// and whether it may read an answer from another origin -- and painting a box
// only when both say yes.
//
// No <webview>: this is the shell's origin, `domicile://shell`, asking for
// itself, which is what a mail counter on manganese's bar would be.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = (root) => {
  /** A query parameter this cannot run without. */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-shell-web-apis: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const parameters = new URLSearchParams(location.search);
  const box = document.createElement("div");

  // Inset, so the witness color stays visible around it, and in whole
  // percentages, so the flat color lands on integer pixels.
  box.style.position = "absolute";
  box.style.left = "10%";
  box.style.top = "10%";
  box.style.width = "80%";
  box.style.height = "70%";

  document.body.style.background = `#${required(parameters, "witness")}`;
  root.append(box);
  const paint = () => {
    box.style.background = `#${required(parameters, "color")}`;
  };

  // `unasked` is the control's first leg: the box painted without a
  // question, which says the harness can see it at all.
  if (parameters.get("unasked") === "1") {
    paint();
  } else {
    const granted = navigator.permissions
      .query({ name: "notifications" })
      .then((status) => status.state === "granted");
    const read = fetch(required(parameters, "api"))
      .then((response) => response.text())
      .then((text) => text === "ok");
    Promise.all([granted, read]).then(
      ([mayNotify, mayRead]) => {
        console.log(`GUARD notifications=${mayNotify} read=${mayRead}`);
        if (mayNotify && mayRead) {
          paint();
        }
      },
      (failure) => {
        console.log(`GUARD refused ${failure}`);
      },
    );
  }
};
