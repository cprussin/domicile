// TypeScript types for a parsed JSON Schema: the root becomes a type named by
// its title, each definition a type of its own, and each description its
// JSDoc.
//
// The output is unformatted; the caller runs a formatter over it.

import { jsDoc } from "./js-doc";
import type { JsonSchema, RootSchema, TypeName } from "./json-schema";

export type Options = {
  /** The file's leading comment, one line each. */
  readonly header: readonly string[];
};

const DEFINITION = "#/$defs/";

/** A property name TypeScript takes unquoted. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const jsonSchemaToTypeScript = (
  { $defs, title, ...root }: RootSchema,
  options: Options,
): string =>
  [
    options.header.map((line) => `// ${line}`.trimEnd()).join("\n"),
    definition(title, root),
    ...Object.entries($defs).map(([name, schema]) => definition(name, schema)),
  ]
    .join("\n\n")
    .concat("\n");

const definition = (name: string, schema: JsonSchema): string =>
  `${doc(schema, "")}export type ${name} = ${typeOf(schema, "")};`;

const typeOf = (schema: JsonSchema, indent: string): string =>
  alternatives(schema, indent).join(" | ");

/** The members of the union `schema` is, one for a type that is not one. */
const alternatives = (
  schema: JsonSchema,
  indent: string,
): readonly string[] => {
  const variants = schema.oneOf ?? schema.anyOf;
  if (schema.$ref !== undefined) {
    return [reference(schema.$ref)];
  } else if (schema.enum !== undefined) {
    return schema.enum.map((value) => JSON.stringify(value));
  } else if (schema.const !== undefined) {
    return [JSON.stringify(schema.const)];
  } else if (variants !== undefined) {
    return variants.flatMap((variant) => alternatives(variant, indent));
  } else if (schema.type === undefined) {
    throw new Error(`no type in ${JSON.stringify(schema)}`);
  } else {
    return [schema.type].flat().map((type) => typeNamed(type, schema, indent));
  }
};

const reference = ($ref: string): string => {
  if ($ref.startsWith(DEFINITION)) {
    return $ref.slice(DEFINITION.length);
  } else {
    throw new Error(`a reference outside the definitions: ${$ref}`);
  }
};

const typeNamed = (
  type: TypeName,
  schema: JsonSchema,
  indent: string,
): string => {
  switch (type) {
    case "array": {
      return arrayOf(schema, indent);
    }
    case "boolean":
    case "null":
    case "string": {
      return type;
    }
    case "integer":
    case "number": {
      return "number";
    }
    case "object": {
      return objectOf(schema, indent);
    }
  }
};

const arrayOf = (schema: JsonSchema, indent: string): string => {
  if (schema.prefixItems !== undefined) {
    return `[${schema.prefixItems.map((item) => typeOf(item, indent)).join(", ")}]`;
  } else if (schema.items === undefined) {
    throw new Error(`an array with no items in ${JSON.stringify(schema)}`);
  } else {
    const element = alternatives(schema.items, indent);
    return element.length === 1
      ? `${element.join("")}[]`
      : `(${element.join(" | ")})[]`;
  }
};

const objectOf = (schema: JsonSchema, indent: string): string => {
  const inner = `${indent}  `;
  const required = new Set(schema.required);
  const properties = Object.entries(schema.properties ?? {}).map(
    ([name, property]) =>
      `${doc(property, inner)}${inner}${propertyName(name)}${required.has(name) ? "" : "?"}: ${typeOf(property, inner)};\n`,
  );
  return properties.length === 0 ? "{}" : `{\n${properties.join("")}${indent}}`;
};

const propertyName = (name: string): string =>
  IDENTIFIER.test(name) ? name : JSON.stringify(name);

const doc = (schema: JsonSchema, indent: string): string =>
  jsDoc(schema.description?.split("\n") ?? [], indent);
