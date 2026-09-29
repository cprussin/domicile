// What guard-webview-active-tab.sh is about: a click on this extension's
// action paints the tab it names, with scripting.executeScript.
//
// THE MANIFEST ASKS FOR NO HOST, only `activeTab` and `scripting`. So the
// injection works only on a page the extension was granted by a click, and
// the click is the tray's `activateExtension` -- that grant is the claim.
//
// The color is the guard's `COLOR`, and scripts/test-webview-active-tab-guard.sh
// holds the two together. `!important`, so the page's own background cannot
// win.
//
// Off `globalThis` because `chrome` is an extension's global, which the linter
// this repository runs over every script does not know.
const { action, scripting } = globalThis.chrome;

// Run in the page, so it closes over nothing: executeScript sends its source.
const paint = () => {
  const mark = document.createElement("style");
  mark.textContent = "html, body { background: #00897B !important; }";
  document.documentElement.append(mark);
};

action.onClicked.addListener((tab) => {
  // A refusal is the finding when the guard fails, so it goes to the log.
  scripting
    .executeScript({ func: paint, target: { tabId: tab.id } })
    .catch((error) => {
      console.error(`GUARD refused ${error.message}`);
    });
});
