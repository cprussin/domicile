# Styling custom bar items

A bar item you add in your config (see [TOP-BAR.md](TOP-BAR.md)) styles itself
with any CSS the build bundles:

- **A CSS file:** `import "./mail.css"`. Works with no setup.
- **Inline styles:** the `style` prop.

```tsx
import "./mail.css";

const Mail = () => <span className="mail">3/12</span>;
```

Manganese ships its own CSS prebuilt, so `domicile` runs no CSS tool on your
config. Its `css()` from `@domicile-desktop/manganese/css` names classes; only
the classes manganese uses have rules.
