# Styling custom bar items

A bar item you add in your config (see [TOP-BAR.md](TOP-BAR.md)) styles itself
with any CSS the build bundles:

- **A CSS file:** `import "./mail.css"`. Works with no setup.
- **Inline styles:** the `style` prop.
- **A CSS tool**, such as Tailwind: add a `vite.config` next to your config
  ([SHELL-PACKAGING.md](/docs/SHELL-PACKAGING.md#build-config)).

```tsx
import "./mail.css";

const Mail = () => <span className="mail">3/12</span>;
```

Manganese ships its own CSS prebuilt, so `domicile` runs no CSS tool on your
config unless your `vite.config` adds one. `css()` from
`@domicile-desktop/manganese/css` gets rules for your own calls only with Panda
in your `vite.config`
([SHELL-PACKAGING.md](/docs/SHELL-PACKAGING.md#panda-with-manganeses-tokens)).
