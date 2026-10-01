// The shell guard-shell-local-network.sh drives: one <img> from a server on
// this machine, which is what a launcher's favicon for a bookmark on
// localhost is.
//
// A module rather than a page, because that is what a shell is here: the
// engine writes the document and loads one module into it. The control is not
// here: it shows the same picture from an ordinary http page, served by
// guard-shell-local-network-server.py.

/** A query parameter this cannot run without. */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-shell-local-network: ?${name}= is required`);
  } else {
    return value;
  }
};

const parameters = new URLSearchParams(location.search);
const picture = document.createElement("img");

// Inset, so the witness color stays visible around it, and in whole
// percentages, so the flat color lands on integer pixels. The control's page
// insets its <img> by the same numbers.
picture.alt = "";
picture.style.position = "absolute";
picture.style.left = "10%";
picture.style.top = "10%";
picture.style.width = "80%";
picture.style.height = "70%";

document.body.style.background = `#${required(parameters, "witness")}`;
document.body.append(picture);
picture.src = required(parameters, "src");
