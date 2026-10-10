// The subset of JSON Schema that `schemars` emits for `domicile-config`, as
// far as it decides a TypeScript type.
//
// Constraints TypeScript cannot state (`minimum`, `pattern`, `default`, …) are
// dropped. Any other keyword is refused, so a schema feature this does not
// handle fails the generator instead of emitting a wrong type.

import { z } from "zod";

const typeNameSchema = z.enum([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

export type TypeName = z.infer<typeof typeNameSchema>;

/** A schema, reduced to what decides its TypeScript type. */
export type JsonSchema = {
  readonly $ref?: string | undefined;
  readonly anyOf?: readonly JsonSchema[] | undefined;
  readonly const?: string | undefined;
  readonly description?: string | undefined;
  readonly enum?: readonly string[] | undefined;
  readonly items?: JsonSchema | undefined;
  readonly oneOf?: readonly JsonSchema[] | undefined;
  readonly prefixItems?: readonly JsonSchema[] | undefined;
  readonly properties?: Readonly<Record<string, JsonSchema>> | undefined;
  readonly required?: readonly string[] | undefined;
  readonly type?: TypeName | readonly TypeName[] | undefined;
};

/** The document: a schema with a title and its definitions. */
export type RootSchema = JsonSchema & {
  readonly $defs: Readonly<Record<string, JsonSchema>>;
  readonly title: string;
};

/** Parse a schema document, throwing on a keyword outside the subset. */
export const parseRootSchema = (value: unknown): RootSchema =>
  rootSchemaSchema.parse(value);

/** Keywords that constrain a value without changing its TypeScript type. */
const constraints = {
  // `false` only: an object open to other keys would need an index signature.
  additionalProperties: z.literal(false).optional(),
  default: z.unknown().optional(),
  format: z.string().optional(),
  maxItems: z.number().optional(),
  minItems: z.number().optional(),
  minimum: z.number().optional(),
  pattern: z.string().optional(),
};

/** The keywords that decide a type. A function, since they recurse. */
const typing = () => ({
  $ref: z.string().optional(),
  anyOf: z.array(jsonSchemaSchema).optional(),
  const: z.string().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  items: jsonSchemaSchema.optional(),
  oneOf: z.array(jsonSchemaSchema).optional(),
  prefixItems: z.array(jsonSchemaSchema).optional(),
  properties: z.record(z.string(), jsonSchemaSchema).optional(),
  required: z.array(z.string()).optional(),
  type: z.union([typeNameSchema, z.array(typeNameSchema)]).optional(),
});

const withoutConstraints = <
  T extends Partial<Record<keyof typeof constraints, unknown>>,
>({
  additionalProperties: _additionalProperties,
  default: _default,
  format: _format,
  maxItems: _maxItems,
  minimum: _minimum,
  minItems: _minItems,
  pattern: _pattern,
  ...typed
}: T): Omit<T, keyof typeof constraints> => typed;

const jsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.strictObject({ ...typing(), ...constraints }).transform(withoutConstraints),
);

const rootSchemaSchema: z.ZodType<RootSchema> = z
  .strictObject({
    ...typing(),
    ...constraints,
    $defs: z.record(z.string(), jsonSchemaSchema),
    $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
    title: z.string(),
  })
  .transform(({ $schema: _, ...root }) => withoutConstraints(root));
