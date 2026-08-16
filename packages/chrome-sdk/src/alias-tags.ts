// Letting a chrome write `<app>` where the SDK registers `<domicile-app>`.
//
// Custom element names must contain a hyphen, so a bare `<app>` can never be
// registered as one — the engine integration is what will eventually make the
// short name real (see docs/architecture/ARCHITECTURE.md). Until then a chrome
// that prefers the short spelling gets it by upgrading: every `<app>` in the
// document, and every one added later, is swapped for the registered element.
//
// This only works for a name the host engine does not already claim. In the
// Electron host `<webview>` is Electron's own tag — and `<domicile-webview>`
// renders one internally — so aliasing that name would recurse. It stays
// hyphenated until Domicile owns the engine.

/**
 * Upgrade every `alias` element under `root` to `real`, and keep upgrading
 * ones added later.
 *
 * @returns The function that stops watching.
 */
export const aliasTag = (
  root: ParentNode & Node,
  alias: string,
  real: string,
): (() => void) => {
  upgradeWithin(root, alias, real);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          upgradeSubtree(node, alias, real);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
};

const upgradeSubtree = (
  element: Element,
  alias: string,
  real: string,
): void => {
  if (element.tagName.toLowerCase() === alias) {
    upgrade(element, real);
  } else {
    upgradeWithin(element, alias, real);
  }
};

const upgradeWithin = (root: ParentNode, alias: string, real: string): void => {
  for (const element of [...root.querySelectorAll(alias)]) {
    upgrade(element, real);
  }
};

// The upgraded element is a new node: a custom element only runs its
// constructor for its registered name, so the attributes and children have to
// be carried over rather than the tag rewritten in place.
const upgrade = (element: Element, real: string): void => {
  const upgraded = document.createElement(real);
  for (const { name, value } of element.attributes) {
    upgraded.setAttribute(name, value);
  }
  upgraded.append(...element.childNodes);
  element.replaceWith(upgraded);
};
