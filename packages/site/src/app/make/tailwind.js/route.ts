// Tailwind's browser build, which styles the "Make your own desktop"
// preview's frame, as the shell's own `@tailwindcss/browser` import does. Read at build time,
// resolved from the site's directory: the bundler rewrites `import.meta.url`.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const dynamic = "force-static";

const SCRIPT = readFileSync(
  createRequire(join(process.cwd(), "package.json")).resolve(
    "@tailwindcss/browser",
  ),
  "utf8",
);

export const GET = (): Response =>
  new Response(SCRIPT, { headers: { "content-type": "text/javascript" } });
