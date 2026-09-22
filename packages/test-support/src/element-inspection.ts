const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Teaches bun's inspector to render a DOM element as its own markup.
 *
 * The inspector is what prints the `received` value of a failed matcher,
 * and a happy-dom element is an object graph that reaches the whole
 * document and window back through its internal fields — so inspecting
 * one walks the entire rendered tree. Measured on the Field error
 * popover, a failing `expect(element).not.toBeInTheDocument()` took 8.9s
 * and produced a 190MB message; with the protocol answered it takes 1ms
 * and 238 characters. Node's inspection protocol is the first thing the
 * inspector asks, so answering it holds a failure to the element the
 * assertion is about — which is the readable message as well as the
 * cheap one.
 */
export const registerElementInspection = () => {
  Object.defineProperty(Element.prototype, INSPECT_CUSTOM, {
    configurable: true,
    // The protocol hands the element over as `this`, which an arrow
    // function has no binding for.
    value: function inspectAsMarkup(this: Element) {
      return this.outerHTML;
    },
    writable: true,
  });
};
