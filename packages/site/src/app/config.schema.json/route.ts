// domicile-desktop.com/config.schema.json: the config file's JSON Schema, from
// the commit the site is built from, so it matches the docs beside it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../../docs/pages";

export const dynamic = "force-static";

const SCHEMA = readFileSync(
  join(REPO_ROOT, "packages/chrome-sdk/config.schema.json"),
  "utf8",
);

export const GET = (): Response =>
  new Response(SCHEMA, {
    headers: { "content-type": "application/schema+json" },
  });
