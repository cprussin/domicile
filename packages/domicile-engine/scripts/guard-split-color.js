// The shell guard-headless-desk.sh drives: `?left=` for the page's first
// `?split=` pixels and `?right=` past them, so a capture of each display shows
// which part of the desk it holds.
//
// With `?clicked=` and `?typed=`, a press past the split turns that side
// `clicked`, and the A key turns the first side `typed`, so a capture shows
// that the desk's input reached the page. The key is matched by its code: the
// guard runs with no compositor, so no keymap.
//
// Everything is inside `HostShell`, which the document Domicile writes calls once
// the module has loaded.

export const HostShell = () => {
  const query = new URLSearchParams(location.search);
  let left = query.get("left");
  let right = query.get("right");
  const split = query.get("split");
  const clicked = query.get("clicked");
  const typed = query.get("typed");
  if (left === null || right === null || split === null) {
    throw new Error(
      "guard-split-color: ?left=, ?right= and ?split= are required",
    );
  } else {
    const paint = () => {
      document.body.style.background = `linear-gradient(to right, #${left} ${split}px, #${right} ${split}px)`;
    };
    document.body.style.margin = "0";
    document.body.style.height = "100vh";
    paint();
    if (clicked !== null) {
      addEventListener("pointerdown", (event) => {
        if (event.clientX >= Number(split)) {
          right = clicked;
          paint();
        }
      });
    }
    if (typed !== null) {
      addEventListener("keydown", (event) => {
        if (event.code === "KeyA") {
          left = typed;
          paint();
        }
      });
    }
  }
};
