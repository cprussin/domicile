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
backward compatibility but will be removed in a future major version.
TypeScript won't flag them, so it's on you to use the suffixed form:

```ts
// correct — use the *Icon-suffixed name
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

// wrong — deprecated alias, do NOT use
import { X } from "@phosphor-icons/react/dist/ssr/X";
```

## Animated icons

The component library has animated versions of some icons, such as
`AnimatedWifiIcon` and `AnimatedBellIcon`. Use one where it exists:

- Each draws Phosphor's own paths, split into parts that move on a state
  change, a cue or hover.
- Keep one rendered across state changes, so the change animates. Don't
  switch between icons for each state.
- To add one, split the icon in `src/_icon/phosphor-parts.ts`; its test
  checks the parts join back into Phosphor's icon. Where Phosphor merges the
  parts into one outline, as with `X`, draw them again in
  `src/_icon/redrawn-parts.ts` from the same strokes and boxes.
- Parts that move apart take a `direction`, such as the corners in
  `src/_icon/diagonals.ts`, so one keyframe serves each of them.

