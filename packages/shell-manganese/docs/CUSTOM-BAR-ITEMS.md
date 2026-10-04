# Styling custom bar items

A bar item you add in your config (see [TOP-BAR.md](TOP-BAR.md)) can use
manganese's Panda CSS:

- `css`, `jsx`, `patterns` and `tokens` come from
  `@domicile-desktop/manganese/css`, `/jsx`, `/patterns` and `/tokens`.
- The builder scans your config's files along with manganese's, so every
  `css()` call you write produces its CSS.

```tsx
import { css } from "@domicile-desktop/manganese/css";

const Mail = () => <span className={css({ color: "muted" })}>3/12</span>;
```
