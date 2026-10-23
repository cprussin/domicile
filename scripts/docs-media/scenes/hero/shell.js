// The Domicile landing page's hero: a terminal on the left, and a web page over
// a second terminal on the right.
const css = `
html, body { background: #141820; }
main { display: flex; gap: 10px; height: 100vh; padding: 10px; box-sizing: border-box; }
main > app { flex: 1; }
section { flex: 1; display: flex; flex-direction: column; gap: 10px; }
section > webview, section > app { flex: 1; }
app, webview { border-radius: 12px; overflow: hidden; min-height: 0; }
`;

export const Shell = (root, domicile) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [sheet];

  const main = document.createElement("main");
  const section = document.createElement("section");
  const page = document.createElement("webview");
  page.setAttribute("src", "https://github.com/cprussin/domicile");
  section.append(page);
  root.append(main);
  main.append(section);

  const mounted = new Map();
  const show = () => {
    const windows = domicile.windows.filter((w) => w.parent === null);
    for (const [id, element] of mounted) {
      if (!windows.some((w) => w.appId === id)) {
        element.remove();
        mounted.delete(id);
      }
    }
    windows.forEach((w, index) => {
      if (mounted.has(w.appId)) {
        return;
      }
      const element = document.createElement("app");
      element.setAttribute("app-id", w.appId);
      if (index === 0) {
        main.prepend(element);
      } else {
        section.append(element);
      }
      mounted.set(w.appId, element);
    });
  };
  show();
  domicile.addEventListener("windowschanged", show);
};
