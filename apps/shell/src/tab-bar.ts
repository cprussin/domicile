// The strip of tabs for the windows the shell has open.
//
// The shell shows one window at a time, so this is how the other ones stay
// reachable. It owns nothing but its own markup: which window is active lives
// with the controller, which tells the bar what to mark.

export type TabBarOptions = {
  root: Element;
  /** Called with the window id whose tab the user clicked. */
  onSelect: (id: string) => void;
};

export class TabBar {
  readonly #root: Element;
  readonly #onSelect: (id: string) => void;
  readonly #tabs = new Map<string, HTMLButtonElement>();

  constructor({ root, onSelect }: TabBarOptions) {
    this.#root = root;
    this.#onSelect = onSelect;
  }

  open(id: string, label: string): void {
    const tab = createTab(label);
    tab.addEventListener("click", () => {
      this.#onSelect(id);
    });
    this.#root.append(tab);
    this.#tabs.set(id, tab);
  }

  rename(id: string, label: string): void {
    this.#tab(id).textContent = label;
  }

  /** Mark `id`'s tab as the window on screen, and every other tab as not. */
  activate(id: string): void {
    const active = this.#tab(id);
    for (const tab of this.#tabs.values()) {
      tab.setAttribute("aria-selected", String(tab === active));
    }
  }

  close(id: string): void {
    this.#tab(id).remove();
    this.#tabs.delete(id);
  }

  #tab(id: string): HTMLButtonElement {
    const tab = this.#tabs.get(id);
    if (tab === undefined) {
      throw new Error(`tab bar: no tab for window ${id}`);
    } else {
      return tab;
    }
  }
}

const createTab = (label: string): HTMLButtonElement => {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "tab";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.textContent = label;
  return tab;
};
