// The extension page for guard-webview-discard.sh. It opens a popup window.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD extension-ready   the popup window is open
//
// Read off `globalThis` because the linter does not know the `chrome` global.
const { windows } = globalThis.chrome;

windows.create({ type: "popup", url: "window.html" }).then(
  () => {
    console.log("GUARD extension-ready");
  },
  (error) => {
    console.log(`GUARD extension-failed ${error.message}`);
  },
);
