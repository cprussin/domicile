// Shell module for guard-shell-shortcuts.sh. It handles no keys, so every key
// returns unhandled to the window's WebContentsDelegate, where Chrome's
// accelerators run.
//
// Console output, read by the guard from the engine log:
//
//   GUARD loaded           once per document; a second one is a reload
//   GUARD keydown code=…   a key reached this document
//   GUARD popstate         history moved (Alt+Left)
//   GUARD resized          the viewport changed (F11 or zoom)

export const Shell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  document.addEventListener("keydown", (event) => {
    say(`keydown code=${event.code}`);
  });
  addEventListener("popstate", () => {
    say("popstate");
  });
  addEventListener("resize", () => {
    say("resized");
  });

  // A same-document entry for Alt+Left, so going back fires `popstate`
  // instead of unloading the page.
  history.pushState({}, "", "#pushed");
  say("loaded");
};
