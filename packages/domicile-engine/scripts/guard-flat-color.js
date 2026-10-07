// The shell guard-display-capture.sh drives: the whole page one flat color,
// which a capture of the desk must show.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = () => {
  const color = new URLSearchParams(location.search).get("color");
  if (color === null) {
    throw new Error("guard-flat-color: ?color= is required");
  } else {
    document.body.style.background = `#${color}`;
  }
};
