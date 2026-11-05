// Every tab, filtered by what is typed. Enter or a click switches to it.
// In Domicile each website on the desktop is a tab, whatever workspace it is
// on, and switching to one asks the desktop to show it.

const { tabs } = globalThis.chrome;

const filter = document.getElementById("filter");
const list = document.getElementById("sites");
const count = document.getElementById("count");

/** Switches to `tab` and closes the popup. */
const switchTo = async (tab) => {
  await tabs.update(tab.id, { active: true });
  window.close();
};

/** A row for `tab`: its icon, title and host. */
const row = (tab) => {
  const item = document.createElement("li");
  const button = document.createElement("button");
  const icon = document.createElement("img");
  icon.alt = "";
  icon.src = tab.favIconUrl ?? "";
  // A site's icon can fail to load in the popup; keep the row's spacing.
  icon.addEventListener("error", () => {
    icon.style.visibility = "hidden";
  });
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = tab.title ?? tab.url ?? "";
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = tab.url === undefined ? "" : new URL(tab.url).host;
  button.append(icon, title, host);
  button.addEventListener("click", async () => {
    await switchTo(tab);
  });
  item.append(button);
  return item;
};

/** The tabs whose title or address has `text` in it. */
const matching = (all, text) =>
  all.filter((tab) =>
    `${tab.title ?? ""} ${tab.url ?? ""}`
      .toLowerCase()
      .includes(text.toLowerCase()),
  );

const all = (await tabs.query({})).filter((tab) => tab.url?.startsWith("http"));
count.textContent = `${all.length} websites open`;

const show = () => {
  list.replaceChildren(...matching(all, filter.value).map(row));
};

filter.addEventListener("input", show);
filter.addEventListener("keydown", async (event) => {
  const first = matching(all, filter.value)[0];
  if (event.key === "Enter" && first !== undefined) {
    await switchTo(first);
  }
});
show();
filter.focus();
