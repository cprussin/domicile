// The shell guard-headless-desk.sh drives: `?left=` for the page's first
// `?split=` pixels and `?right=` past them, so a capture of each display shows
// which part of the desk it holds.
//
// Everything is inside `HostShell`, which the document Domicile writes calls once
// the module has loaded.

export const HostShell = () => {
  const query = new URLSearchParams(location.search);
  const left = query.get("left");
  const right = query.get("right");
  const split = query.get("split");
  if (left === null || right === null || split === null) {
    throw new Error(
      "guard-split-color: ?left=, ?right= and ?split= are required",
    );
  } else {
    document.body.style.margin = "0";
    document.body.style.background = `linear-gradient(to right, #${left} ${split}px, #${right} ${split}px)`;
  }
};
