// The `<domicile-webview>` custom element: web content the engine renders
// directly (a nested browsing context), so the element itself is just a typed
// marker around the embed.

export class DomicileWebviewElement extends HTMLElement {
  static observedAttributes = ["src"];

  #view: HTMLElement | undefined;

  get src(): string | undefined {
    return this.getAttribute("src") ?? undefined;
  }

  set src(value: string) {
    this.setAttribute("src", value);
  }

  connectedCallback(): void {
    this.#ensureView();
  }

  attributeChangedCallback(name: string): void {
    if (name === "src") {
      this.#ensureView();
    }
  }

  // In the Electron host this is a real `<webview>` (a separate browsing
  // context, so it can load sites that forbid `<iframe>` embedding); the
  // eventual engine maps `<domicile-webview>` to a native CEF browsing context.
  #ensureView(): void {
    this.#view ??= this.appendChild(createWebviewFrame());
    const src = this.src;
    if (src !== undefined) {
      this.#view.setAttribute("src", src);
    }
  }
}

const createWebviewFrame = (): HTMLElement => {
  const view = document.createElement("webview");
  view.className = "domicile-webview-frame";
  return view;
};
