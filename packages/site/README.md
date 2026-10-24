# @domicile-desktop/site

domicile-desktop.com: the Domicile landing page for shell authors (`/`) and
the manganese landing page for its users (`/manganese`). A Next.js app,
hosted on Vercel and built from `stable`.

```sh
bun run start:dev     # http://localhost:3000
bun run build:next
```

- **Styling:** Panda CSS on the component library's preset, like every
  package. `Accent` sets `accent` to the product's color: violet for
  Domicile, the preset's cyan for manganese.
- **Code blocks:** highlighted at build time (`src/code/`).
- **Screenshots and videos:** `public/media` links to `docs/media`, which
  `packages/site/scripts/docs-media.sh` captures on crux. Vercel can't deploy a link out of
  the root directory, so its build swaps the link for a copy. A slot whose capture does not
  exist yet says what it will show. See
  [docs/media/README.md](/docs/media/README.md).
- **Docs links** point at the markdown on GitHub until the docs move into the
  site.

## Vercel

- Root directory: `packages/site`. `vercel.json` installs from the
  repository root, filtered to the site and the packages it uses, which runs
  their `prepare` (Panda codegen). It installs with the repository's bun
  (`packageManager`), since Vercel's own is older.
- Production branch: `stable`.
- `vercel-ignore.sh` skips every deployment but production, since each build
  costs. It logs what it decided at the top of the build log.
- Vercel also skips a `stable` push that changes nothing under
  `packages/site` or its dependencies. To deploy without a site change, use
  **Redeploy** on the latest production deployment.
