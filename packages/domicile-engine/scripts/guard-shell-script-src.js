// The shell guard-shell-script-src.sh drives. It adds script the way markup
// from outside could, plus one script from the shell root as the control, and
// reports which ran:
//
//   GUARD script-src inline=<ran|blocked> handler=<ran|blocked>
//                    self=<ran|blocked>

const ran = new Set();
window.guardRan = (which) => ran.add(which);

export const Shell = async (root) => {
  // An inline script runs as it is inserted, if it runs at all.
  const inline = document.createElement("script");
  inline.textContent = 'guardRan("inline");';
  root.append(inline);

  // Markup a shell might render from a notification body. The attribute's
  // handler is registered first, so it has run by the time `handler` settles.
  const holder = document.createElement("div");
  holder.innerHTML =
    '<img src="guard-shell-script-src-missing.png" onerror="guardRan(\'handler\')">';
  const handler = settled(holder.firstElementChild, "error", "load");
  root.append(holder);

  // The control: a script from the shell root must run, or this page could
  // not see a script run at all.
  const self = document.createElement("script");
  self.src = "guard-shell-script-src-self.js";
  const loaded = settled(self, "load", "error");
  root.append(self);

  await Promise.all([handler, loaded]);
  console.log(
    "GUARD script-src" +
      ` inline=${verdict("inline")}` +
      ` handler=${verdict("handler")}` +
      ` self=${verdict("self")}`,
  );
};

const settled = (element, ...events) =>
  new Promise((resolve) => {
    for (const event of events) {
      element.addEventListener(event, resolve, { once: true });
    }
  });

const verdict = (which) => (ran.has(which) ? "ran" : "blocked");
