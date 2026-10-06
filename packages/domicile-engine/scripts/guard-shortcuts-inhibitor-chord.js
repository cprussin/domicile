// Shell module for guard-shortcuts-inhibitor-chord.sh. Logs which keys reach
// the window.
//
// It is a module because the engine writes the shell's document and loads one
// module into it. See ShellURLLoaderFactory::ShellDocument.
//
// The guard also watches a sway binding; together they show which side of the
// inhibitor a Meta chord reached. This uses a plain DOM listener, not
// `domicile.grabShortcut`, so browser-side matching cannot affect the result.
//
// Console lines (the engine writes them to its log):
//
//   GUARD listening          the keydown listener is attached
//   GUARD focused            the document has keyboard focus
//   GUARD keydown key=… meta=…
//                            a key reached the document. Logs `key`, not
//                            `code`: the virtual keyboard uploads its own
//                            keymap, so `code` does not name the requested key
//
// The document Domicile writes calls `Shell` once the module loads.

export const Shell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  // Capture on the window so nothing in the document can stop a key first.
  window.addEventListener(
    "keydown",
    (event) => {
      say(`keydown key=${event.key} meta=${event.metaKey}`);
    },
    { capture: true },
  );
  say("listening");

  // Poll instead of waiting for `focus`: the window may be activated before
  // this module runs.
  const watchingFocus = setInterval(() => {
    if (document.hasFocus()) {
      say("focused");
      clearInterval(watchingFocus);
    }
  }, 100);
};
