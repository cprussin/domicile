// The Domicile page's blended demo: a desktop laid out as an article. A live
// terminal floats in the text and the text wraps around it, a website and a
// film sit in it as figures, and a heading blends over the film. The article
// scrolls, and every window scrolls with it.

const CSS = `
html, body { background: #f4f1ea; color: #23201b; margin: 0; overflow: hidden; }
article {
  animation: read 16s ease-in-out infinite alternate;
  font: 22px/1.6 "DejaVu Serif", serif; margin: 0 auto; padding: 56px 0; width: 1100px;
}
@keyframes read { from { transform: translateY(0); } to { transform: translateY(-900px); } }
h1 { font: 700 64px/1.1 Inter, sans-serif; letter-spacing: -0.02em; margin: 0 0 24px; }
p { margin: 0 0 22px; }
app, webview { border-radius: 10px; display: block; overflow: hidden; }
.terminal { float: right; height: 330px; margin: 6px 0 16px 32px; width: 520px; }
figure { margin: 32px 0; }
figure webview { height: 520px; width: 100%; }
figcaption { color: #6b6457; font: 17px Inter, sans-serif; margin-top: 10px; }
.film { position: relative; }
.film app { height: 560px; width: 100%; }
.film h2 {
  color: white; font: 800 120px/1 Inter, sans-serif; left: 40px; margin: 0;
  mix-blend-mode: difference; position: absolute; top: 40px;
}
`;

const TEXT = [
  "This desktop is one web page. The paragraphs are HTML, and so is the layout. The windows are native Wayland apps and websites, placed in it like images.",
  "The terminal to the right is a real foot window running asciiquarium. It floats, so this text wraps around it, the same way it would around a photo.",
  "Scroll the page and the windows scroll with it. They're elements, so the page lays them out, clips them and composites them in the same frame as everything else.",
];

export const Shell = (root, domicile) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  document.adoptedStyleSheets = [sheet];

  const article = document.createElement("article");
  const title = document.createElement("h1");
  title.textContent = "A desktop that reads like a page";
  const terminal = document.createElement("app");
  terminal.className = "terminal";
  const paragraphs = TEXT.map((text) => {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  });

  const site = document.createElement("figure");
  const page = document.createElement("webview");
  page.setAttribute("src", "https://en.wikipedia.org/wiki/Big_Buck_Bunny");
  const siteCaption = document.createElement("figcaption");
  siteCaption.textContent =
    "A website, as a figure. It's a live browser window.";
  site.append(page, siteCaption);

  const film = document.createElement("figure");
  film.className = "film";
  const player = document.createElement("app");
  const heading = document.createElement("h2");
  heading.textContent = "Big Buck Bunny";
  const filmCaption = document.createElement("figcaption");
  filmCaption.textContent =
    "mpv, a native app. The heading over it is HTML, blended with mix-blend-mode.";
  film.append(player, heading, filmCaption);

  article.append(title, terminal, ...paragraphs, site, film);
  root.append(article);

  // The first window is the terminal, the second the film.
  const show = () => {
    const windows = (domicile.windows.list ?? []).filter((w) => !w.parent);
    [terminal, player].forEach((element, at) => {
      const appId = windows[at]?.appId;
      if (appId !== undefined) {
        element.setAttribute("app-id", appId);
      }
    });
  };
  show();
  domicile.windows.on("change", show);
};
