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
  `scripts/docs-media.sh` captures on crux. A slot whose capture does not
  exist yet says what it will show. See
  [docs/media/README.md](/docs/media/README.md).
- **Docs links** point at the markdown on GitHub until the docs move into the
  site.

## Vercel

- Root directory: `packages/site`. Vercel installs from the repository root,
  which runs each package's `prepare` (Panda codegen).
- Production branch: `stable`.
