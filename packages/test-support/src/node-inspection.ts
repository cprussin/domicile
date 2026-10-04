const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Makes bun's inspector print a DOM node as markup instead of its object
 * graph.
 *
 * Failed matchers inspect the `received` value. A happy-dom node references
 * its document and window, so the default output can run to megabytes.
 */
export const registerNodeInspection = () => {
  Object.defineProperty(Node.prototype, INSPECT_CUSTOM, {
    configurable: true,
    // Not an arrow function: the protocol passes the node as `this`.
    value: function inspectNode(this: Node) {
      return describeNode(this);
    },
    writable: true,
  });
};

/**
 * Renders a node as short, readable text for failure messages.
 *
 * Character data prints with its node name (`#text "Hello"`) so a text node
 * is not mistaken for a plain string.
 */
const describeNode = (node: Node): string => {
  if (node instanceof Element) {
    return node.outerHTML;
  } else if (node instanceof CharacterData) {
    return `${node.nodeName} ${JSON.stringify(node.data)}`;
  } else if (node instanceof Document) {
    return node.documentElement.outerHTML;
  } else {
    return Array.from(node.childNodes, describeNode).join("");
  }
};
