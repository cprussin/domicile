// The shell guard-shortcut-chords.sh drives. Once the stand-in has described
// the keyboard it grabs three chords by name, presses keys on itself, and --
// after the stand-in has pressed Meta+Shift+l too -- reports:
//
//   GUARD listening                   the channel is bound
//   GUARD chords bad=<error> missing=<error> page=<…> heard=<chords> released=<chords>
//
// `page` is, for Meta+Shift+l, the same held as a repeat, and Meta+k, whether
// the engine took each from the page; `heard` is every `shortcut`'s chord and
// `released` every `shortcutrelease`'s. The page lets go of k, which releases
// nothing, then Shift, which releases Meta+Shift+l.

const thrown = (grab) => {
  try {
    grab();
    return "nothing";
  } catch (error) {
    return error?.name ?? String(error);
  }
};

const press = (code, init) => key("keydown", code, init);

const key = (type, code, init) => {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event.defaultPrevented ? "taken" : "free";
};

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-shortcut-chords: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  const heard = [];
  host.addEventListener("shortcut", (event) => {
    heard.push(event.chord);
  });
  const released = [];
  host.addEventListener("shortcutrelease", (event) => {
    released.push(event.chord);
  });
  console.log("GUARD listening");

  setTimeout(() => {
    const bad = thrown(() => host.grabShortcut("Bogus+l"));
    const missing = thrown(() => host.grabShortcut("Meta+nosuchkey"));
    host.grabShortcut("Meta+Shift+l");
    const page = [
      press("KeyL", { metaKey: true, shiftKey: true }),
      press("KeyL", { metaKey: true, repeat: true, shiftKey: true }),
      press("KeyK", { metaKey: true }),
    ].join(",");
    key("keyup", "KeyK", { metaKey: true, shiftKey: true });
    key("keyup", "ShiftLeft", { metaKey: true });
    setTimeout(() => {
      console.log(
        `GUARD chords bad=${bad} missing=${missing} page=${page} heard=${heard.join(",")} released=${released.join(",")}`,
      );
    }, 3500);
  }, 1000);
};
