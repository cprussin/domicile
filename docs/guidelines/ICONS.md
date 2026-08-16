# Phosphor Icons

Always import icons from `@phosphor-icons/react/dist/ssr/<IconName>`,
**never** from `@phosphor-icons/react` directly. The barrel import pulls
in every icon and breaks SSR / React Server Component compatibility. Use
one import per icon:

```ts
// correct
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

// wrong — barrel import, do NOT use
import { CaretRightIcon, XIcon } from "@phosphor-icons/react";
```

Always import the `*Icon`-suffixed name (e.g. `XIcon`, `CaretRightIcon`,
`WarningCircleIcon`). The unsuffixed names (`X`, `CaretRight`,
`WarningCircle`) are **deprecated** aliases — they still exist for
backwards compatibility but will be removed in a future major version.
TypeScript won't flag them, so it's on you to use the suffixed form:

```ts
// correct — use the *Icon-suffixed name
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

// wrong — deprecated alias, do NOT use
import { X } from "@phosphor-icons/react/dist/ssr/X";
```
