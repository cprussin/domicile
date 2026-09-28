// The mark guard-webview-content-script.sh looks for: the whole page in one
// flat color that no page it serves paints. `!important`, so the page's own
// background cannot win. The color is the guard's `COLOR`, and
// scripts/test-webview-content-script-guard.sh holds the two together.
const mark = document.createElement("style");
mark.textContent = "html, body { background: #8E24AA !important; }";
document.documentElement.append(mark);
