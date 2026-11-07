// domicile-desktop.com/.well-known/matrix/server: sends Matrix federation for
// domicile-desktop.com to the site, which answers the room alias lookup.
// Points at www because Vercel redirects the bare domain there, and Matrix
// servers follow redirects for this file but not for federation requests.
// Served from `src/app/.well-known`, which `bun test` skips, so it lives here.

export const GET = (): Response =>
  Response.json({ "m.server": "www.domicile-desktop.com:443" });
