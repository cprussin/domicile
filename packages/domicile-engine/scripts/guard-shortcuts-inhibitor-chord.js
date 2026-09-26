// The shell guard-shortcuts-inhibitor-chord.sh drives: a desktop's window that
// says which keys reached it.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument.
//
// THIS IS ONE OF THE GUARD'S TWO OBSERVERS. The other is a sway binding that
// writes a line when it fires; between them they say which side of the
// inhibitor a Meta chord landed on. A plain DOM listener rather than
// `domicile.grabShortcut`, because what is under test is whether the key
// reached the page at all, and a claim would put the browser process's
// matching between the key and the reading.
//
// WHAT THIS PAGE SAYS, to the console, which the engine writes to its own log:
//
//   GUARD listening          the listener below is attached, so a key that
//                            reaches this document will be reported. Without
//                            it, "the page did not get the chord" is true of a
//                            page that could not have said so
//   GUARD focused            this document has focus, which it has only while
//                            the host has given the window the keyboard
//   GUARD keydown key=… meta=…
//                            a key reached this document. `key` rather than
//                            `code`: the virtual keyboard uploads a keymap of
//                            its own with its keys at codes it chose, so the
//                            code names whatever key sits there on a real
//                            keyboard and the key is what was asked for

const say = (what) => {
  console.log(`GUARD ${what}`);
};

// Capture, on the window, so that nothing in the document can stop a key before
// it is reported. There is nothing else in the document, but a reading that
// depended on that would be a reading about the document.
window.addEventListener(
  "keydown",
  (event) => {
    say(`keydown key=${event.key} meta=${event.metaKey}`);
  },
  { capture: true },
);
say("listening");

// Asked on an interval rather than on `focus`, because the window can be
// activated before this module runs, and a `focus` event that fired first is
// one this would wait on for ever.
const watchingFocus = setInterval(() => {
  if (document.hasFocus()) {
    say("focused");
    clearInterval(watchingFocus);
  }
}, 100);
