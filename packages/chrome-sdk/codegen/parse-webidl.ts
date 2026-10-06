// A WebIDL parser for the subset the engine's `modules/domicile/` IDL uses:
// interfaces, dictionaries and enums, with the `//` comments above each
// definition and member kept as its documentation.
//
// It throws on anything outside that subset, so new syntax in the IDL fails
// the generator instead of being dropped from the SDK's types.

/** One token: whitespace, a `//` comment, a string, a number, a word or punctuation. */
const TOKEN =
  /\s+|\/\/[^\n]*|"[^"\n]*"|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[{}()[\]<>;,=?:]/y;

/** The words that start a type of two or more. */
const MULTI_WORD_TYPES: Readonly<Record<string, readonly string[]>> = {
  unrestricted: ["double", "float"],
  unsigned: ["long", "short"],
};

/** A type: `DOMString`, `unsigned long`, `FrozenArray<DomicileWindow>?`. */
export type IdlType = {
  readonly arguments: readonly IdlType[];
  readonly name: string;
  readonly nullable: boolean;
};

export type IdlArgument = {
  readonly name: string;
  readonly type: IdlType;
};

export type IdlAttribute = {
  readonly doc: readonly string[];
  readonly name: string;
  readonly type: IdlType;
};

export type IdlOperation = {
  readonly arguments: readonly IdlArgument[];
  readonly doc: readonly string[];
  readonly name: string;
  readonly returnType: IdlType;
};

/** An `attribute EventHandler on<name>`: the interface fires `<name>`. */
export type IdlEvent = {
  readonly doc: readonly string[];
  readonly name: string;
};

export type IdlInterface = {
  readonly attributes: readonly IdlAttribute[];
  readonly doc: readonly string[];
  readonly events: readonly IdlEvent[];
  readonly inherits: string | undefined;
  readonly name: string;
  readonly operations: readonly IdlOperation[];
};

export type IdlDictionaryMember = {
  /** Whether it has a default, so it is always present when read. */
  readonly defaulted: boolean;
  readonly doc: readonly string[];
  readonly name: string;
  readonly required: boolean;
  readonly type: IdlType;
};

export type IdlDictionary = {
  readonly doc: readonly string[];
  readonly inherits: string | undefined;
  readonly members: readonly IdlDictionaryMember[];
  readonly name: string;
};

export type IdlEnum = {
  readonly doc: readonly string[];
  readonly name: string;
  readonly values: readonly string[];
};

/** The definitions in one or more IDL files. Constructors are dropped. */
export type Idl = {
  readonly dictionaries: readonly IdlDictionary[];
  readonly enums: readonly IdlEnum[];
  readonly interfaces: readonly IdlInterface[];
};

type Comment = { readonly line: number; readonly text: string };

type Token = {
  /** The `//` lines between the previous token and this one. */
  readonly comments: readonly Comment[];
  readonly line: number;
  readonly text: string;
};

export const parseWebIdl = (source: string): Idl => {
  const parser = new Parser(tokenize(source));
  const interfaces: IdlInterface[] = [];
  const dictionaries: IdlDictionary[] = [];
  const enums: IdlEnum[] = [];
  while (!parser.done()) {
    const doc = definitionDoc(parser.peek().comments);
    parser.skipExtendedAttributes();
    const keyword = parser.next();
    switch (keyword.text) {
      case "interface": {
        interfaces.push(parseInterface(parser, doc));
        break;
      }
      case "dictionary": {
        dictionaries.push(parseDictionary(parser, doc));
        break;
      }
      case "enum": {
        enums.push(parseEnum(parser, doc));
        break;
      }
      default: {
        throw parser.unexpected(keyword);
      }
    }
  }
  return { dictionaries, enums, interfaces };
};

const tokenize = (source: string): readonly Token[] => {
  const tokens: Token[] = [];
  let comments: Comment[] = [];
  let line = 1;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (match === null) {
      throw new Error(
        `line ${line}: unexpected ${JSON.stringify(source.slice(start, start + 10))}`,
      );
    } else {
      const text = match[0];
      if (text.startsWith("//")) {
        comments.push({ line, text: text.replace(/^\/\/ ?/, "") });
      } else if (text.trim() !== "") {
        tokens.push({ comments, line, text });
        comments = [];
      }
      line += text.split("\n").length - 1;
    }
  }
  return tokens;
};

/**
 * Every comment block above a definition except the license header, as
 * paragraphs. A definition's comment may be set apart from it by a blank line.
 */
const definitionDoc = (comments: readonly Comment[]): readonly string[] =>
  commentBlocks(comments)
    .filter((block) => !block[0]?.text.startsWith("Copyright"))
    .flatMap((block, index) => [
      ...(index === 0 ? [] : [""]),
      ...blockText(block),
    ]);

/** The comment block directly above a member, with no blank line between. */
const memberDoc = (token: Token): readonly string[] => {
  const last = commentBlocks(token.comments).at(-1);
  return last !== undefined && last.at(-1)?.line === token.line - 1
    ? blockText(last)
    : [];
};

/** A block's lines, without the empty `//` lines at either end. */
const blockText = (block: readonly Comment[]): readonly string[] => {
  const lines = block.map((comment) => comment.text);
  const first = lines.findIndex((line) => line !== "");
  const last = lines.findLastIndex((line) => line !== "");
  return lines.slice(first, last + 1);
};

const commentBlocks = (
  comments: readonly Comment[],
): readonly (readonly Comment[])[] =>
  comments.reduce<Comment[][]>((blocks, comment) => {
    const block = blocks.at(-1);
    if (block !== undefined && block.at(-1)?.line === comment.line - 1) {
      block.push(comment);
    } else {
      blocks.push([comment]);
    }
    return blocks;
  }, []);

const parseInterface = (
  parser: Parser,
  doc: readonly string[],
): IdlInterface => {
  const name = parser.identifier();
  const inherits = parseInheritance(parser);
  const attributes: IdlAttribute[] = [];
  const operations: IdlOperation[] = [];
  const events: IdlEvent[] = [];
  parser.expect("{");
  while (parser.peek().text !== "}") {
    const memberDocLines = memberDoc(parser.peek());
    parser.skipExtendedAttributes();
    const first = parser.peek();
    switch (first.text) {
      case "constructor": {
        parser.next();
        parseArguments(parser, true);
        break;
      }
      case "readonly": {
        parser.next();
        parser.expect("attribute");
        const type = parseType(parser);
        attributes.push({
          doc: memberDocLines,
          name: parser.identifier(),
          type,
        });
        break;
      }
      case "attribute": {
        parser.next();
        parser.expect("EventHandler");
        events.push({ doc: memberDocLines, name: parseHandlerName(parser) });
        break;
      }
      default: {
        const returnType = parseType(parser);
        const operationName = parser.identifier();
        operations.push({
          arguments: parseArguments(parser, false),
          doc: memberDocLines,
          name: operationName,
          returnType,
        });
      }
    }
    parser.expect(";");
  }
  parser.expect("}");
  parser.expect(";");
  return { attributes, doc, events, inherits, name, operations };
};

/** `on<name>`, as `<name>`. */
const parseHandlerName = (parser: Parser): string => {
  const token = parser.peek();
  const handler = parser.identifier();
  if (handler.startsWith("on")) {
    return handler.slice("on".length);
  } else {
    throw parser.unexpected(token);
  }
};

const parseDictionary = (
  parser: Parser,
  doc: readonly string[],
): IdlDictionary => {
  const name = parser.identifier();
  const inherits = parseInheritance(parser);
  const members: IdlDictionaryMember[] = [];
  parser.expect("{");
  while (parser.peek().text !== "}") {
    const memberDocLines = memberDoc(parser.peek());
    const required = parser.peek().text === "required";
    if (required) {
      parser.next();
    }
    const type = parseType(parser);
    const memberName = parser.identifier();
    const defaulted = parser.peek().text === "=";
    if (defaulted) {
      parser.next();
      parseDefault(parser);
    }
    parser.expect(";");
    members.push({
      defaulted,
      doc: memberDocLines,
      name: memberName,
      required,
      type,
    });
  }
  parser.expect("}");
  parser.expect(";");
  return { doc, inherits, members, name };
};

const parseEnum = (parser: Parser, doc: readonly string[]): IdlEnum => {
  const name = parser.identifier();
  const values: string[] = [];
  parser.expect("{");
  while (parser.peek().text !== "}") {
    values.push(parser.string());
    if (parser.peek().text === ",") {
      parser.next();
    }
  }
  parser.expect("}");
  parser.expect(";");
  return { doc, name, values };
};

const parseInheritance = (parser: Parser): string | undefined => {
  if (parser.peek().text === ":") {
    parser.next();
    return parser.identifier();
  } else {
    return undefined;
  }
};

/**
 * `(type name, ...)`. Only a constructor may take an optional argument, since
 * constructors are not emitted.
 */
const parseArguments = (
  parser: Parser,
  allowOptional: boolean,
): readonly IdlArgument[] => {
  const result: IdlArgument[] = [];
  parser.expect("(");
  while (parser.peek().text !== ")") {
    const first = parser.peek();
    if (first.text === "optional") {
      if (allowOptional) {
        parser.next();
      } else {
        throw parser.unexpected(first);
      }
    }
    const type = parseType(parser);
    result.push({ name: parser.identifier(), type });
    if (parser.peek().text === "=") {
      parser.next();
      parseDefault(parser);
    }
    if (parser.peek().text === ",") {
      parser.next();
    }
  }
  parser.expect(")");
  return result;
};

const parseType = (parser: Parser): IdlType => {
  const name = parseTypeName(parser);
  const typeArguments = parseTypeArguments(parser);
  const nullable = parser.peek().text === "?";
  if (nullable) {
    parser.next();
  }
  return { arguments: typeArguments, name, nullable };
};

const parseTypeName = (parser: Parser): string => {
  const first = parser.identifier();
  const followers = MULTI_WORD_TYPES[first];
  const words =
    followers === undefined ? [first] : [first, parser.oneOf(followers)];
  // `long long` and `unsigned long long`.
  if (words.at(-1) === "long" && parser.peek().text === "long") {
    words.push(parser.identifier());
  }
  return words.join(" ");
};

const parseTypeArguments = (parser: Parser): readonly IdlType[] => {
  if (parser.peek().text === "<") {
    parser.next();
    const argument = parseType(parser);
    parser.expect(">");
    return [argument];
  } else {
    return [];
  }
};

/** A default value: dropped, since only its presence matters to the types. */
const parseDefault = (parser: Parser): void => {
  const first = parser.next();
  if (first.text === "[") {
    parser.expect("]");
  } else if (first.text === "{") {
    parser.expect("}");
  }
};

class Parser {
  readonly #tokens: readonly Token[];
  #index = 0;

  constructor(tokens: readonly Token[]) {
    this.#tokens = tokens;
  }

  done(): boolean {
    return this.#index >= this.#tokens.length;
  }

  peek(): Token {
    const token = this.#tokens[this.#index];
    if (token === undefined) {
      throw new Error("unexpected end of IDL");
    } else {
      return token;
    }
  }

  next(): Token {
    const token = this.peek();
    this.#index += 1;
    return token;
  }

  expect(text: string): void {
    const token = this.next();
    if (token.text !== text) {
      throw new Error(
        `line ${token.line}: expected ${JSON.stringify(text)}, got ${JSON.stringify(token.text)}`,
      );
    }
  }

  oneOf(texts: readonly string[]): string {
    const token = this.next();
    if (texts.includes(token.text)) {
      return token.text;
    } else {
      throw this.unexpected(token);
    }
  }

  identifier(): string {
    const token = this.next();
    if (/^[A-Za-z_]/.test(token.text)) {
      return token.text;
    } else {
      throw this.unexpected(token);
    }
  }

  string(): string {
    const token = this.next();
    if (token.text.startsWith('"')) {
      return token.text.slice(1, -1);
    } else {
      throw this.unexpected(token);
    }
  }

  /** `[...]`, which says nothing the types need. */
  skipExtendedAttributes(): void {
    if (this.peek().text === "[") {
      while (this.next().text !== "]") {
        // Extended attributes do not nest in this IDL.
      }
    }
  }

  unexpected(token: Token): Error {
    return new Error(
      `line ${token.line}: unexpected ${JSON.stringify(token.text)}`,
    );
  }
}
