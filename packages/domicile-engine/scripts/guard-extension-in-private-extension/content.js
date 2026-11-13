// Paints the page in the color guard-extension-in-private.sh looks for.
// Must match the guard's `COLOR`; packages/domicile-engine/tests/test-extension-in-private-guard.sh
// checks that.
const mark = document.createElement("style");
mark.textContent = "html, body { background: #D81B60 !important; }";
document.documentElement.append(mark);
