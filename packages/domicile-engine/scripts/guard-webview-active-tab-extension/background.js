// Fixture for guard-webview-active-tab.sh: clicking this extension's action
// paints the tab it names via scripting.executeScript.
//
// The manifest requests no host permissions, only `activeTab` and
// `scripting`, so injection works only after a click grants the tab. The click
// is the tray's `activateExtension`; that grant is what the guard checks.
//
// The color must match the guard's `COLOR`
// (scripts/test-webview-active-tab-guard.sh checks this). `!important` beats
// the page's own background.
//
// Read from `globalThis` because the repo's linter does not know the
// extension global `chrome`.
const { action, scripting } = globalThis.chrome;

// Runs in the page, so it must not close over anything: executeScript sends
// its source.
const paint = () => {
  const mark = document.createElement("style");
  mark.textContent = "html, body { background: #00897B !important; }";
  document.documentElement.append(mark);
};

action.onClicked.addListener((tab) => {
  // Log refusals; they explain a failing guard.
  scripting
    .executeScript({ func: paint, target: { tabId: tab.id } })
    .catch((error) => {
      console.error(`GUARD refused ${error.message}`);
    });
});

// Set the badge only after registering the listener: the shell waits for it
// before clicking. The tray row appears at install, before this worker runs,
// and a click dispatched with no listener is dropped.
action.setBadgeText({ text: "on" }).catch((error) => {
  console.error(`GUARD refused ${error.message}`);
});
