// The Domicile page's CSS demo: three native windows and a website in a grid,
// restyled by one CSS rule after another. The strip at the foot shows the
// rule in effect, as the page applies it, so the recording needs no captions.

/** The rules, in turn. Each replaces the one before. */
const RULES = [
  "main { grid-template: 1fr 1fr / 1fr 1fr; }",
  "app, webview { transform: perspective(1200px) rotateY(-18deg) scale(0.9); }",
  "main > :not(:first-child) { filter: blur(6px) grayscale(1); scale: 0.92; }",
  "app:nth-of-type(2) { rotate: 6deg; } webview { rotate: -4deg; opacity: 0.85; }",
  "main { grid-template: 1fr 1fr 1fr / 2fr 1fr; } main > :first-child { grid-row: span 3; }",
];

/** How long each rule shows, in milliseconds. */
const RULE_MS = 3500;

const BASE = `
html, body { background: #141820; margin: 0; overflow: hidden; }
main {
  box-sizing: border-box; display: grid; gap: 14px; height: calc(100vh - 72px);
  grid-template: 1fr 1fr / 1fr 1fr; padding: 14px;
  transition: grid-template 0.8s;
}
app, webview {
  border-radius: 14px; height: 100%; min-height: 0; min-width: 0; overflow: hidden; width: 100%;
  transition: transform 0.8s, filter 0.8s, scale 0.8s, rotate 0.8s, opacity 0.8s;
}
footer {
  align-items: center; box-sizing: border-box; color: #e8eaf0; display: flex;
  font: 22px "JetBrains Mono", monospace; gap: 18px; height: 72px; padding: 0 24px;
}
footer span { color: #7aa2f7; }
`;

export const Shell = (root, domicile) => {
  const base = new CSSStyleSheet();
  base.replaceSync(BASE);
  const current = new CSSStyleSheet();
  document.adoptedStyleSheets = [base, current];

  const main = document.createElement("main");
  const page = document.createElement("webview");
  page.setAttribute("src", "https://en.wikipedia.org/wiki/Wayland_(protocol)");
  main.append(page);
  const footer = document.createElement("footer");
  const label = document.createElement("span");
  label.textContent = "css";
  const shown = document.createElement("code");
  footer.append(label, shown);
  root.append(main, footer);

  // Native windows go before the website, in the order they open.
  const mounted = new Map();
  const show = () => {
    const windows = (domicile.windows.list ?? []).filter((w) => !w.parent);
    for (const [id, element] of mounted) {
      if (!windows.some((w) => w.appId === id)) {
        element.remove();
        mounted.delete(id);
      }
    }
    for (const w of windows) {
      if (!mounted.has(w.appId)) {
        const element = document.createElement("app");
        element.setAttribute("app-id", w.appId);
        page.before(element);
        mounted.set(w.appId, element);
      }
    }
  };
  show();
  domicile.windows.on("change", show);

  let at = 0;
  const next = () => {
    const rule = RULES[at % RULES.length];
    current.replaceSync(rule);
    shown.textContent = rule;
    at += 1;
  };
  next();
  setInterval(next, RULE_MS);
};
