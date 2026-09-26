// The shell guard-shell-shortcuts.sh presses Chrome's own shortcuts at.
//
// A module rather than a page, because that is what a shell is: the engine
// writes the document and loads exactly one module into it.
//
// IT HANDLES NOTHING, which is the experiment. A key a shell leaves alone
// comes back to the window's WebContentsDelegate, which is where Chrome ran
// its accelerators from -- so every key here is one the browser would have
// acted on, if anything still does.
//
// WHAT THIS PAGE SAYS, to the console, which the engine writes to its log:
//
//   GUARD loaded           once per document. A second one is a reload
//   GUARD keydown code=…   a key reached this document, and so came back
//                          unhandled to the delegate behind it
//   GUARD popstate         the shell's history moved: Alt+Left went back
//   GUARD resized          the viewport changed: F11 or a zoom

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

// Something for Alt+Left to go back to. Same-document, so a browser that
// took the key would fire `popstate` rather than unload the page.
history.pushState({}, "", "#pushed");
say("loaded");
