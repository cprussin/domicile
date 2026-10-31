// The live-swap scene's desktop: every window in one grid, which `css` lays
// out. `side-by-side.js` and `stacked.js` differ only in that rule. `<app>` is
// a replaced element, 300x150 by default, which a grid cell doesn't stretch.
export const mount = (root, domicile, css) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
html, body { background: #141820; margin: 0; }
main { display: grid; gap: 10px; height: 100vh; padding: 10px; box-sizing: border-box; }
app { width: 100%; height: 100%; border-radius: 12px; overflow: hidden; min-height: 0; min-width: 0; }
${css}
`);
  document.adoptedStyleSheets = [sheet];

  const main = document.createElement("main");
  root.append(main);
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
        main.append(element);
        mounted.set(w.appId, element);
      }
    }
  };
  show();
  domicile.windows.on("change", show);
};
