// Paints the page in the color guard-webview-content-script.sh looks for.
// Must match the guard's `COLOR`; scripts/test-webview-content-script-guard.sh
// checks that.
const mark = document.createElement("style");
mark.textContent = "html, body { background: #8E24AA !important; }";
document.documentElement.append(mark);
