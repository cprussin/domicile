// domicile-desktop.com/.well-known/matrix/server: sends Matrix federation for
// domicile-desktop.com to the site on 443, which answers the room alias lookup.
// Served from `src/app/.well-known`, which `bun test` skips, so it lives here.

export const GET = (): Response =>
  Response.json({ "m.server": "domicile-desktop.com:443" });
