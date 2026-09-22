const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Teaches bun's inspector to render a DOM node as itself rather than as
 * its object graph.
 *
 * The inspector is what prints the `received` value of a failed matcher,
 * and a happy-dom node reaches the whole document and window back through
 * its internal fields — so inspecting one walks the entire rendered tree.
 * Measured on a twenty-field form, a failing assertion on a *detached*
 * comment produced 825KB and a text node 1.2MB, because the charge grows
 * with the document rather than with the node under test. Answering
 * Node's inspection protocol — the first thing the inspector asks — holds
 * a failure to the node the assertion is about, which is the readable
 * message as well as the cheap one.
 */
export const registerNodeInspection = () => {
  Object.defineProperty(Node.prototype, INSPECT_CUSTOM, {
    configurable: true,
    // The protocol hands the node over as `this`, which an arrow
    // function has no binding for.
    value: function inspectNode(this: Node) {
      return describeNode(this);
    },
    writable: true,
  });
};

/**
 * `outerHTML` is the whole answer for an element, and the rest of the DOM
 * has no single equivalent: character data carries its text, a document
 * carries a root element, and a fragment is only its children.
 *
 * Character data is named rather than serialized (`#text "Hello"`, not
 * `Hello`) so a text node is not mistaken for a plain string in a message
 * that prints both. That naming reaches children too, so a fragment
 * holding character data directly reads `#comment "x"` where a serializer
 * would write `<!--x-->` — in a failure the node kind is worth more than
 * the angle brackets are.
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
