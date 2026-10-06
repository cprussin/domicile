// Shell module for guard-shell-web-apis.sh. Paints a box only if the shell's
// own origin has notification permission and can read a cross-origin fetch,
// as a bar widget such as a mail counter would need.

export const Shell = (root) => {
  /** Reads a required query parameter. */
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

  // Inset so the witness shows around it. Whole percentages keep the color on
  // integer pixels.
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

  // `unasked=1` is the control's first leg: paint without checking, to prove
  // the harness can see the box.
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
